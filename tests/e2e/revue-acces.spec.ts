import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import PizZip from "pizzip";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 6, lot 6c — revue des accès (rapport, admin et direction) et page d'aide (US-6.2).
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours exécuté une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

test("direction : revue des accès à l’écran et export Excel", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "direction@exemple.test");
  await page.goto("/rapports?rapport=access_review");
  await expect(page.getByRole("heading", { level: 2, name: "Revue des accès" })).toBeVisible();
  const admin = page.getByRole("row").filter({ hasText: "Awa Admin (démo)" });
  await expect(admin).toContainText("Administrateur");
  await expect(admin).toContainText("non"); // 2FA requise mais pas encore configurée

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger (Excel)" }).click();
  const zip = new PizZip(readFileSync(await (await downloadPromise).path()));
  const sheet = zip.file("xl/worksheets/sheet1.xml")!.asText();
  expect(sheet).toContain("Revue des accès");
  expect(sheet).toContain("Administrateur");
});

test("comptabilité : pas de revue des accès", async ({ page }) => {
  await signIn(page, "compta@exemple.test");
  await page.goto("/rapports?rapport=access_review");
  const tabs = page.getByRole("navigation", { name: "Rapports" });
  await expect(tabs.getByRole("link", { name: "Revue des accès" })).toHaveCount(0);
  await page.goto("/rapports/export?rapport=access_review");
  await expect(page).toHaveURL(/\/acces-refuse/);
});

test("aide : guide par écran, section administration pour la direction", async ({ page }) => {
  await signIn(page, "direction@exemple.test");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Aide" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aide");
  await expect(page.getByRole("heading", { level: 2, name: "Tableau de bord" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Administration/ })).toBeVisible();
  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("aide : l’agent opérations ne voit pas la section administration", async ({ page }) => {
  await signIn(page, "ops@exemple.test");
  await page.goto("/aide");
  await expect(page.getByRole("heading", { level: 2, name: "Dossiers" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Administration/ })).toHaveCount(0);
});
