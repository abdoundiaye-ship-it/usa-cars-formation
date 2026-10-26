import { expect, test } from "@playwright/test";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 2, lot 2a — US-2.1 (fiche client) et US-2.2 (dossier, contrat, acceptation) sur Supabase local.
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

/** Petit PDF valide (preuve scannée fictive). */
const PROOF_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj " +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test("agent : client, dossier, contrat généré puis accepté par scan", async ({ page }) => {
  test.setTimeout(90_000); // parcours complet : création, génération du contrat, téléchargement, preuve
  await signIn(page, "ops@exemple.test");

  // US-2.1 — fiche client (numéro saisi au format local, normalisé en +221…)
  const name = `Client Parcours ${Date.now()} (démo)`;
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Clients" }).click();
  await page.getByRole("link", { name: "Nouveau client" }).click();
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("WhatsApp de notification").fill("abc");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByText(/format international/).first()).toBeVisible();
  await expect(page.getByLabel("Nom complet")).toHaveValue(name); // saisie conservée après l'erreur
  await page.getByLabel("WhatsApp de notification").fill("77 000 00 99");
  await page.getByLabel("Adresse").fill("Dakar, adresse fictive");
  await page.getByLabel("Pièce d’identité").selectOption("passport");
  await page.getByLabel("Numéro de la pièce").fill("DEMO-PASS-99");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByText("Fiche client créée.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByText("+221770000099").first()).toBeVisible();

  // US-2.2 — ouverture du dossier : référence UC-AAAA-#### et contrat généré
  await page.getByRole("link", { name: "Ouvrir un dossier" }).click();
  await page.getByLabel("Plateforme").selectOption("copart");
  await page.getByLabel("VIN / châssis").fill("1demxxx0000000099");
  await page.getByLabel("Marque").fill("Toyota");
  await page.getByLabel("Modèle").fill("Corolla");
  await page.getByLabel("Année").fill("2019");
  await page.getByRole("button", { name: "Ouvrir le dossier et générer le contrat" }).click();
  // Ouverture + génération et dépôt du contrat : plus long que les autres actions.
  await expect(page.getByText("Dossier ouvert et contrat généré.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Dossier UC-\d{4}-\d{4,}$/);
  await expect(page.getByText("En attente de signature")).toBeVisible();
  await expect(page.getByLabel("VIN / châssis")).toHaveValue("1DEMXXX0000000099");

  // Téléchargement : lien signé vers le fichier Word généré
  const href = await page.getByRole("link", { name: "Télécharger le contrat (Word)" }).getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.ok()).toBe(true);
  expect((await download.body()).subarray(0, 2).toString()).toBe("PK"); // archive .docx

  // R15 — acceptation par papier signé scanné, avec preuve
  await page.getByLabel("Contrat signé scanné").setInputFiles({
    name: "contrat-signe.pdf",
    mimeType: "application/pdf",
    buffer: PROOF_PDF,
  });
  await page.getByRole("button", { name: "Enregistrer la décision du client" }).click();
  // Le formulaire laisse place au récapitulatif de la décision (preuve téléchargeable).
  await expect(page.getByText("Accepté par le client")).toBeVisible();
  await expect(page.getByText("Accepté", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Télécharger la preuve" })).toBeVisible();
  await expect(page.getByLabel("Statut dans l’étape")).toHaveValue("contract_signed");
  await expect(page.getByText("Contrat accepté (papier signé scanné)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer la décision du client" })).toHaveCount(0);

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("direction : consultation des dossiers sans action d’écriture", async ({ page }) => {
  await signIn(page, "direction@exemple.test");
  await page.goto("/dossiers?q=DEMO-2026-0001");
  await page.getByRole("link", { name: "DEMO-2026-0001" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier DEMO-2026-0001");
  await expect(page.getByText("Mamadou Diallo (démo)").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer le véhicule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dupliquer le dossier" })).toHaveCount(0);

  await page.goto("/dossiers/nouveau");
  await expect(page).toHaveURL(/\/acces-refuse/);
});
