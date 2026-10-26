import { expect, test, type Locator, type Page } from "@playwright/test";
import PizZip from "pizzip";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 5, lot 5b — US-5.3 : procédure « véhicule non réclamé » sur DEMO-2026-0007 (arrivé il y a 65 jours,
// 3 000 $US dus, véhicule non enlevé) : relance, mise en demeure, envoi avec preuve ; procédure pas encore possible.
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});
test.describe.configure({ mode: "serial", retries: 0 });

const PROOF = {
  name: "accuse-reception.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% accusé de réception (démo)\n"),
};

async function openUnclaimed(page: Page): Promise<Locator> {
  await page.goto("/dossiers?q=DEMO-2026-0007");
  await page.getByRole("link", { name: "DEMO-2026-0007" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier DEMO-2026-0007");
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Véhicule non réclamé (contrat art. 21–22)" }) });
}

async function downloadedText(page: Page, href: string): Promise<string> {
  const response = await page.request.get(href);
  expect(response.ok()).toBe(true);
  const zip = new PizZip(await response.body());
  const xml = ["word/document.xml", "word/header1.xml"].map((f) => zip.file(f)!.asText()).join("");
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
}

/** Le fichier peut échouer au démarrage à froid de la fonction locale : « Générer le fichier » le relance. */
async function ensureLetterFile(section: Locator) {
  const download = section.getByRole("link", { name: "Télécharger le courrier (Word)" }).last();
  for (let attempt = 0; attempt < 3 && !(await download.isVisible()); attempt++) {
    const retry = section.getByRole("button", { name: "Générer le fichier" });
    if (await retry.isVisible()) await retry.click();
    await download.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  }
  await expect(download).toBeVisible();
  return download;
}

async function recordSending(section: Locator, page: Page) {
  await section.getByText("Enregistrer l’envoi…").click();
  await section.getByLabel("Envoyé par").selectOption("hand");
  await section.getByLabel("Preuve d’envoi").setInputFiles(PROOF);
  await section.getByRole("button", { name: "Enregistrer l’envoi" }).click();
  await expect(page.getByText(/visible dans l’espace client/).first()).toBeVisible();
}

test("comptabilité : relance puis mise en demeure envoyées, procédure pas encore possible", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "compta@exemple.test");
  let section = await openUnclaimed(page);
  await expect(section.getByText(/Arrivé le \d{2}\/\d{2}\/\d{4} : J\+65\. Reste dû : 3\s000\s\$US/)).toBeVisible();

  // Lettre de relance : émise, fichier Word (PROJET, sans coordonnées de paiement), envoi avec preuve.
  await section.getByRole("button", { name: "Émettre la lettre de relance" }).click();
  await expect(section.getByText(/Lettre de relance LR-\d{4}-\d{4}/)).toBeVisible();
  let download = await ensureLetterFile(section);
  const reminderText = await downloadedText(page, (await download.getAttribute("href"))!);
  expect(reminderText).toMatch(/LETTRE DE RELANCE N° LR-\d{4}-\d{4}/);
  expect(reminderText.replace(/\s/g, " ")).toContain("3 000 $US");
  expect(reminderText).toContain("PROJET");
  expect(reminderText).not.toMatch(/IBAN|Wave :|Orange Money :/);
  await recordSending(section, page);

  // Mise en demeure : délai inférieur au minimum du contrat refusé, puis émise avec 15 jours.
  section = await openUnclaimed(page);
  await section.getByLabel("Délai de régularisation (jours)").fill("10");
  await section.getByRole("button", { name: "Émettre la mise en demeure" }).click();
  await expect(section.getByText("Le délai de régularisation ne peut pas être inférieur à 15 jours")).toBeVisible();
  await section.getByLabel("Délai de régularisation (jours)").fill("15");
  await section.getByRole("button", { name: "Émettre la mise en demeure" }).click();
  await expect(section.getByText(/Mise en demeure MD-\d{4}-\d{4}/)).toBeVisible();
  download = await ensureLetterFile(section);
  const noticeText = await downloadedText(page, (await download.getAttribute("href"))!);
  expect(noticeText).toContain("quinze (15) jours à compter de la réception");
  expect(noticeText).toContain("Aucune appropriation automatique du véhicule");
  await recordSending(section, page);

  section = await openUnclaimed(page);
  await expect(section.getByText(/régularisation attendue au plus tard le \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await expect(section.getByText(/Procédure possible à partir du/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Ouvrir la procédure de non-réclamation" })).toHaveCount(0);

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("agent opérations : consulte la procédure sans émettre de courrier ; alerte d’arrivée au tableau de bord", async ({
  page,
}) => {
  await signIn(page, "ops@exemple.test");
  const todo = page.locator("section").filter({ has: page.getByRole("heading", { name: "À traiter", exact: true }) });
  await expect(
    todo
      .getByRole("listitem")
      .filter({ hasText: "DEMO-2026-0007" })
      .filter({ hasText: "Client non informé de l’arrivée" }),
  ).toBeVisible();

  const section = await openUnclaimed(page);
  await expect(section.getByText(/Mise en demeure MD-\d{4}-\d{4}/)).toBeVisible();
  await expect(section.getByRole("button", { name: /Émettre|Enregistrer l’envoi|Ouvrir la procédure/ })).toHaveCount(0);
  await expect(section.getByText("Le système ne change jamais la propriété du véhicule")).toBeVisible();
});
