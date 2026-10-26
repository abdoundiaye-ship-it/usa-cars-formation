import { expect, test, type Page } from "@playwright/test";
import PizZip from "pizzip";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 3, lot 3c — US-3.6 (paiements), US-3.7 (facture de solde), US-3.9 (frais supplémentaires), US-3.12
// (trop-perçu) sur le dossier de démonstration DEMO-2026-0005 (en mer, paiement 1 réglé, reste 3 200 $US).
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});
// Étapes enchaînées sur le même dossier, sans nouvelle tentative : la facture de solde n'est émise qu'une fois.
test.describe.configure({ mode: "serial", retries: 0 });

const PDF = {
  name: "justificatif.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% justificatif (démo)\n"),
};

async function openSettlement(page: Page) {
  await page.goto("/dossiers?q=DEMO-2026-0005");
  await page.getByRole("link", { name: "DEMO-2026-0005" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier DEMO-2026-0005");
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Paiements, solde et remboursements", exact: true }) });
}

async function downloadedText(page: Page, href: string): Promise<string> {
  const response = await page.request.get(href);
  expect(response.ok()).toBe(true);
  const zip = new PizZip(await response.body());
  const xml = ["word/document.xml", "word/header1.xml"].map((f) => zip.file(f)!.asText()).join("");
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
}

test("comptabilité : frais supplémentaires, facture de solde, paiement et trop-perçu restitué", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "compta@exemple.test");
  let settlement = await openSettlement(page);
  await expect(settlement.getByRole("row", { name: /Solde restant dû/ })).toContainText("3 200 $US");

  // US-3.9 : frais supplémentaires sous le seuil (R7) → ajoutés au solde
  await settlement.getByText("Ajouter des frais supplémentaires…").click();
  await settlement.getByLabel("Nature des frais").fill("Manutention au port (démo)");
  await settlement.getByLabel("Montant (USD)", { exact: true }).fill("100");
  await settlement.getByLabel("Justificatif des frais").setInputFiles(PDF);
  await settlement.getByRole("button", { name: "Ajouter les frais" }).click();
  await expect(page.getByText("Frais supplémentaires enregistrés.")).toBeVisible({ timeout: 30_000 });
  await expect(settlement.getByText("Ajouté au solde")).toBeVisible();

  // US-3.7 : facture de solde = B + C + D, ETA de référence figée
  await settlement.getByRole("button", { name: "Émettre la facture de solde" }).click();
  await expect(page.getByText("Facture de solde émise. Téléchargez le fichier pour l’envoyer au client.")).toBeVisible({
    timeout: 30_000,
  });
  settlement = await openSettlement(page);
  const invoice = settlement.getByRole("article", { name: /^Facture de solde FS-\d{4}-\d{4,}$/ });
  await expect(invoice.getByRole("row", { name: /Solde à payer/ })).toContainText("3 300 $US");
  await expect(invoice).toContainText("ETA de référence");
  const text = await downloadedText(
    page,
    (await invoice.getByRole("link", { name: "Télécharger (Word)" }).getAttribute("href"))!,
  );
  expect(text).toMatch(/FACTURE DE SOLDE N° FS-\d{4}-\d{4,}/);
  expect(text).toContain("DEMU1234560");
  expect(text).toContain("Manutention au port (démo)");

  // US-3.6 : paiement du solde (3 500 $US pour 3 300 dus) → trop-perçu de 200 $US à restituer (C6)
  await settlement.getByText("Enregistrer un paiement…").click();
  await settlement.getByLabel("Montant reçu (USD)").fill("3 500");
  await settlement.getByLabel("Référence du paiement").fill("DEMO-VIR-SOLDE");
  await settlement.getByLabel("Justificatif", { exact: true }).setInputFiles(PDF);
  await settlement.getByRole("button", { name: "Enregistrer le paiement" }).click();
  await expect(page.getByText("Paiement enregistré.")).toBeVisible({ timeout: 30_000 });
  await expect(invoice.getByText("Payé", { exact: true })).toBeVisible();
  const refund = settlement.getByRole("listitem").filter({ hasText: "Trop-perçu" });
  await expect(refund).toContainText("200 $US");
  await expect(refund).toContainText("À valider (administrateur)");
  // C9 : seul l'administrateur valide un remboursement.
  await expect(page.getByRole("button", { name: "Valider le remboursement" })).toHaveCount(0);

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("comptabilité : écran Finances — soldes, échéances et remboursement à valider", async ({ page }) => {
  await signIn(page, "compta@exemple.test");
  await page.goto("/finances");
  const todo = page.locator("section").filter({ has: page.getByRole("heading", { name: "À traiter", exact: true }) });
  await expect(todo.getByRole("listitem").filter({ hasText: "DEMO-2026-0005" })).toContainText("200 $US");
  const balances = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Soldes des dossiers", exact: true }) });
  const row = balances.getByRole("row").filter({ hasText: "DEMO-2026-0005" });
  await expect(row).toContainText("Trop-perçu");
  await expect(row).toContainText("Réglé"); // aucune échéance restante
});

test("agent : remise des documents après le paiement intégral (US-3.11), sans saisie de paiement", async ({ page }) => {
  await signIn(page, "ops@exemple.test");
  const settlement = await openSettlement(page);
  await expect(settlement.getByRole("heading", { name: "Facture de solde", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Émettre la facture de solde" })).toHaveCount(0);
  await expect(page.getByText("Enregistrer un paiement…")).toHaveCount(0);

  const release = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Remise des documents", exact: true }) });
  await expect(release).toContainText("la propriété du véhicule est transférée au client");
  await release.getByLabel("Numéro de la pièce").fill("DEMO-CNI-0005");
  await release.getByLabel("Décharge signée du bénéficiaire").setInputFiles({ ...PDF, name: "decharge.pdf" });
  await release.getByRole("button", { name: "Enregistrer la remise des documents" }).click();
  await expect(release.getByText("Remis le")).toBeVisible({ timeout: 30_000 });
  await expect(release.getByRole("link", { name: "Décharge signée" })).toBeVisible();
  await expect(page.getByText(/Documents remis à /).first()).toBeVisible();

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});
