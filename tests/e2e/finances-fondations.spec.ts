import { expect, test } from "@playwright/test";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 3, lot 3a — US-3.1 (coûts internes, marge), US-3.2 (forfaits), US-3.5 (taux), US-3.10 (comptes officiels).
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

test("agent : forfaits, coût interne et marge implicite sur un dossier", async ({ page }) => {
  await signIn(page, "ops@exemple.test");
  await page.goto("/dossiers?q=DEMO-2026-0002");
  await page.getByRole("link", { name: "DEMO-2026-0002" }).click();
  await page.waitForURL(/\/dossiers\/[0-9a-f-]{36}/, { timeout: 30_000 });

  const finance = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Forfaits et coûts internes", exact: true }) });
  await expect(finance.getByText("Interne — jamais visible du client")).toBeVisible();
  await finance.getByLabel("Forfait A — acquisition (USD)").fill("12 000");
  await finance.getByLabel("Forfait B — logistique et maritime (USD)").fill("3 500");
  await finance.getByRole("button", { name: "Enregistrer les forfaits" }).click();
  await expect(finance.getByText("Forfaits enregistrés.")).toBeVisible();

  await finance
    .locator("details")
    .last()
    .evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await finance.getByLabel("Poste").selectOption("hammer_price");
  await finance.getByLabel("Montant (USD)").last().fill("10 000");
  await finance.getByRole("button", { name: "Ajouter le coût" }).click();
  await expect(finance.getByRole("cell", { name: /^Prix d’adjudication/ }).first()).toBeVisible();

  // Marge A = 12 000 − 10 000 = 2 000 $US (16,7 %)
  const lineA = finance
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "A — Acquisition", exact: true }) });
  await expect(lineA).toContainText("2 000 $US");
  await expect(lineA).toContainText("16,7 %");

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("direction : taux de change et comptes officiels en consultation", async ({ page }) => {
  await signIn(page, "direction@exemple.test");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Finances" }).click();
  await expect(page.getByText(/1\s\$US = 587,1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer le taux" })).toHaveCount(0);

  await page.goto("/parametres/comptes-officiels");
  await expect(page.getByText("Compte bancaire Démo (fictif)")).toBeVisible();
  await expect(page.getByText("Wave Démo (fictif)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer le compte" })).toHaveCount(0);

  // Décision J1 : calendrier des jours fériés (jours ouvrés), tenu par l'administrateur.
  await page.goto("/parametres/jours-feries");
  await expect(page.getByRole("cell", { name: "Lundi de Pâques" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter le jour férié" })).toHaveCount(0);
});
