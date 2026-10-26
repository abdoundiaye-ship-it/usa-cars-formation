import { expect, test, type Locator, type Page } from "@playwright/test";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 4, lot 4a — US-4.1 (lien de connexion à usage unique), US-4.2 (acceptation du devis dans le portail),
// US-4.3 (suivi, documents, instructions de paiement), isolation entre clients (règle 3).
// Client de démonstration : Mamadou Diallo (client@exemple.test), dossiers DEMO-2026-0001, 0004 et 0006.
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});
test.describe.configure({ mode: "serial", retries: 0 }); // le devis n'est émis et accepté qu'une fois

const section = (page: Page, title: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });

/** Document émis : relance « Générer le fichier » si la fonction a été interrompue (démarrage à froid). */
async function ensureFile(document: Locator) {
  await expect(document).toBeVisible({ timeout: 30_000 });
  const download = document.getByRole("link", { name: "Télécharger (Word)" });
  for (let attempt = 0; attempt < 3 && !(await download.isVisible()); attempt++) {
    await document.getByRole("button", { name: "Générer le fichier" }).click();
    await download.waitFor({ timeout: 30_000 }).catch(() => undefined);
  }
  await expect(download).toBeVisible();
}

let loginLink = "";

test("agent : devis émis sur DEMO-2026-0006, lien de connexion envoyé au client", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "ops@exemple.test");
  await page.goto("/dossiers?q=DEMO-2026-0006");
  await page.getByRole("link", { name: "DEMO-2026-0006" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier DEMO-2026-0006");
  const billing = section(page, "Devis, dépôt et facture d’acompte");
  await billing.getByRole("button", { name: "Émettre le devis" }).click();
  await ensureFile(billing.getByRole("article", { name: /^Devis DV-/ }));

  await page.goto("/clients/c0000000-0000-4000-8000-000000000001"); // Mamadou Diallo (démo)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mamadou Diallo (démo)");
  const portal = section(page, "Accès au portail client");
  await expect(portal).toContainText("client@exemple.test");
  await portal.getByRole("button", { name: "Envoyer un nouveau lien de connexion" }).click();
  const link = portal.getByLabel("Lien de connexion du client");
  await expect(link).toBeVisible({ timeout: 60_000 }); // création du compte au besoin, puis du lien
  loginLink = await link.inputValue();
  expect(loginLink).toMatch(/\/connexion\/lien\/[A-Za-z0-9_-]{30,}$/);

  // US-4.5 : le lien part par e-mail et par WhatsApp (envoi simulé sans fournisseur), visible dans le journal.
  await page.goto("/notifications");
  const rows = page.getByRole("row").filter({ hasText: "Lien de connexion" }).filter({ hasText: "Mamadou Diallo" });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).not.toContainText("/connexion/lien/"); // le lien n'apparaît jamais dans le journal
});

test("client : connexion par le lien, devis accepté dans le portail avec l’assurance", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Le jeton n'est consommé qu'au clic (un aperçu automatique du lien ne l'utilise pas).
  await page.goto(new URL(loginLink).pathname);
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();
  await page.waitForURL(/\/espace$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mes dossiers");
  await expect(page.getByText("Dossier DEMO-2026-0006", { exact: true })).toBeVisible();
  await expect(page.getByText("Dossier DEMO-2026-0001", { exact: true })).toBeVisible();
  await expect(page.getByText("DEMO-2026-0003")).toHaveCount(0); // dossier d'un autre client

  await page.getByRole("link", { name: "Voir le dossier DEMO-2026-0006" }).click();
  await expect(page.getByText("Votre devis attend votre réponse")).toBeVisible();
  const quote = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Votre devis DV-/ }) });
  await expect(quote).toContainText("13 300 $US");
  await quote.getByRole("button", { name: "Accepter le devis" }).click();
  await expect(quote.getByText("Indiquez si vous souhaitez l’assurance transport (option C).")).toBeVisible();
  await quote.getByLabel("Je souhaite l’assurance transport").check();
  await quote.getByLabel(/J’ai lu le devis affiché/).check();
  await quote.getByRole("button", { name: "Accepter le devis" }).click();
  await expect(
    page.getByText(/Devis DV-\d{4}-\d{4,} accepté, assurance transport acceptée \(portail client\)/),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: /^Votre devis DV-/ })).toHaveCount(0);
  await expect(section(page, "Instructions de paiement")).toContainText("ne communique jamais un changement de compte");
  // Jamais de coût interne ni de marge dans le portail (règle 2).
  await expect(page.getByText(/marge|coût interne|Prix d’adjudication/i)).toHaveCount(0);

  // Le lien est à usage unique.
  const again = await context.newPage();
  await again.goto(new URL(loginLink).pathname);
  await again.getByRole("button", { name: "Accéder à mon espace" }).click();
  await expect(again.getByText("Ce lien n’est plus valide")).toBeVisible();

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
  await context.close();
});

test("client : isolation — le dossier d’un autre client est introuvable", async ({ page }) => {
  await signIn(page, "client@exemple.test");
  await expect(page).toHaveURL(/\/espace$/);
  const response = await page.goto("/espace/dossiers/e0000000-0000-4000-8000-000000000003");
  expect(response?.status()).toBe(404);
  // L'espace interne reste fermé au client.
  await page.goto("/dossiers");
  await expect(page).not.toHaveURL(/\/dossiers$/);
});
