import { expect, test, type Page } from "@playwright/test";
import PizZip from "pizzip";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 3, lot 3b — US-3.3 (devis), US-3.4 (dépôt et facture d'acompte) sur le dossier de démonstration
// DEMO-2026-0004 (lot remporté, forfaits saisis, dépôt de 2 500 $US reçu).
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

const PDF = {
  name: "devis-signe.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% devis signé (démo)\n"),
};

async function openDossier(page: Page) {
  await page.goto("/dossiers?q=DEMO-2026-0004");
  await page.getByRole("link", { name: "DEMO-2026-0004" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier DEMO-2026-0004");
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Devis, dépôt et facture d’acompte", exact: true }) });
}

/** Texte du fichier Word téléchargé (corps et en-tête). */
async function downloadedText(page: Page, href: string): Promise<string> {
  const response = await page.request.get(href);
  expect(response.ok()).toBe(true);
  const zip = new PizZip(await response.body());
  const xml = ["word/document.xml", "word/header1.xml"].map((f) => zip.file(f)!.asText()).join("");
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
}

// Deux étapes enchaînées sur le même dossier : la seconde n'a de sens que si la première a réussi.
test.describe.serial("devis puis facture d'acompte", () => {
  test.describe.configure({ retries: 0 }); // le devis n'est émis qu'une fois par base : pas de nouvelle tentative
  test("agent : devis émis, sans coût interne dans le fichier, accepté avec l'assurance", async ({ page }) => {
    await signIn(page, "ops@exemple.test");
    const billing = await openDossier(page);

    // US-3.3 : émission (numéro DV, taux du jour figé, validité alignée sur le paiement 1 — X2)
    await billing.getByRole("button", { name: "Émettre le devis" }).click();
    await expect(page.getByText("Devis émis. Téléchargez le fichier pour l’envoyer au client.")).toBeVisible({
      timeout: 30_000,
    });
    const quote = billing.getByRole("article", { name: /^Devis DV-\d{4}-\d{4,}$/ });
    await expect(quote.getByText("Émis", { exact: true })).toBeVisible();
    await expect(quote).toContainText("valable jusqu’au");
    await expect(quote.getByRole("row", { name: /Total hors assurance/ })).toContainText("15 100 $US");

    // CLAUDE.md règle 2 : le fichier généré ne contient aucun coût interne du dossier.
    const text = await downloadedText(
      page,
      (await quote.getByRole("link", { name: "Télécharger (Word)" }).getAttribute("href"))!,
    );
    expect(text).toContain("DEMO-2026-0004");
    expect(text).toMatch(/DEVIS N° DV-\d{4}-\d{4,}/);
    for (const internal of [
      "Prix d’adjudication IAA (démo)",
      "Frais IAA (démo)",
      "Fret maritime (démo)",
      "9 437",
      "873 $US",
      "1 781",
    ]) {
      expect(text).not.toContain(internal);
    }

    // R15 / X1 : acceptation par papier signé, avec le choix d'assurance
    const now = new Date(Date.now() - 60_000).toISOString().slice(11, 16);
    await quote.getByLabel("Accepte l’assurance").check();
    await quote.getByLabel("Heure de signature").fill(now);
    await quote.getByLabel("Devis signé scanné").setInputFiles(PDF);
    await quote.getByRole("button", { name: "Enregistrer la décision sur le devis" }).click();
    // Le formulaire laisse place au récapitulatif de la décision.
    // Téléversement de la preuve puis enregistrement : plus long que les autres actions.
    await expect(quote.getByText("Accepté", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(quote.getByText("Accepté par le client")).toBeVisible();
    await expect(quote).toContainText("Assurance transport : acceptée");
    // L'agent n'émet pas de facture (docs/12).
    await expect(page.getByRole("button", { name: "Émettre la facture d’acompte" })).toHaveCount(0);
  });

  test("comptabilité : complément de dépôt en FCFA, puis facture d'acompte", async ({ page }) => {
    await signIn(page, "compta@exemple.test");
    const billing = await openDossier(page);
    await billing.getByText("Enregistrer un dépôt reçu…").click();
    await billing.getByLabel("Devise reçue").selectOption("XOF");
    await billing.getByLabel("Montant reçu (FCFA)").fill("300 000");
    await billing.getByLabel("Mode de paiement").selectOption("cash");
    await billing.getByLabel("Référence du paiement").fill("DEMO-ESP-0001");
    await billing.getByRole("button", { name: "Enregistrer le dépôt" }).click();
    await expect(page.getByText("Dépôt enregistré.")).toBeVisible({ timeout: 30_000 });
    // 300 000 FCFA au taux du jour 587,10 = 510,99 $US (R1)
    await expect(billing.getByRole("cell", { name: /510,99\s\$US/ })).toBeVisible();

    await billing.getByRole("button", { name: "Émettre la facture d’acompte" }).click();
    await expect(
      page.getByText("Facture d’acompte émise. Téléchargez le fichier pour l’envoyer au client."),
    ).toBeVisible({
      timeout: 30_000,
    });
    const invoice = billing.getByRole("article", { name: /^Facture d’acompte FA-\d{4}-\d{4,}$/ });
    // 11 800 − (2 500 + 510,99) = 8 789,01 $US
    await expect(invoice.getByRole("row", { name: /Reste à payer/ })).toContainText("8 789,01 $US");
    await expect(invoice.getByRole("link", { name: "Télécharger (Word)" })).toBeVisible();
    await expect(page.getByText(/Facture d’acompte FA-\d{4}-\d{4,} émise : 8\s789,01\s\$US/)).toBeVisible();

    await page.setViewportSize({ width: 400, height: 800 });
    await expectNoHorizontalScroll(page);
  });
});

test("direction : devis et factures en consultation seulement", async ({ page }) => {
  await signIn(page, "direction@exemple.test");
  const billing = await openDossier(page);
  await expect(billing.getByText("Dépôt attendu (ordre d’achat)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Émettre le devis" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer le dépôt" })).toHaveCount(0);
});
