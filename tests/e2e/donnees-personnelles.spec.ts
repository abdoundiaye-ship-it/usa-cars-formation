import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import PizZip from "pizzip";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 6, lot 6b — données personnelles : rapport « Conservation des données » (G2-a, admin et direction) et page
// « Confidentialité » du portail (G1-a). DEMO-2026-0008 est terminé (clôturé le jour du seed) : durées atteintes
// dans 5 ans (autres données) et 10 ans (pièces comptables).
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours exécuté une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

const inYears = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
};

test("direction : dossiers dont la durée de conservation est atteinte, export Excel", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "direction@exemple.test");
  await page.goto("/rapports?rapport=retention");
  await expect(page.getByRole("heading", { level: 2, name: "Conservation des données" })).toBeVisible();
  await expect(page.getByText(/La purge n’est jamais automatique/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "DEMO-2026-0008" })).toHaveCount(0); // rien d'atteint

  await page.getByLabel("Situation au").fill(inYears(10));
  await page.getByRole("button", { name: "Afficher" }).click();
  await expect(page.getByRole("row").filter({ hasText: "DEMO-2026-0008" })).toContainText("Toutes les données");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger (Excel)" }).click();
  const download = await downloadPromise;
  const zip = new PizZip(readFileSync(await download.path()));
  const sheet = zip.file("xl/worksheets/sheet1.xml")!.asText();
  expect(sheet).toContain("DEMO-2026-0008");
  expect(sheet).toContain("Toutes les données");
});

test("comptabilité : pas de rapport de conservation", async ({ page }) => {
  await signIn(page, "compta@exemple.test");
  await page.goto("/rapports?rapport=retention");
  const tabs = page.getByRole("navigation", { name: "Rapports" });
  await expect(tabs.getByRole("link", { name: "Conservation des données" })).toHaveCount(0);
  await page.goto("/rapports/export?rapport=retention");
  await expect(page).toHaveURL(/\/acces-refuse/);
});

test("client : page Confidentialité (PROJET), durées issues des paramètres", async ({ page }) => {
  await signIn(page, "client@exemple.test");
  await page.getByRole("link", { name: "Confidentialité" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confidentialité");
  await expect(page.getByText("PROJET — texte en cours de validation par USA CARS.")).toBeVisible();
  await expect(page.getByText(/pièces comptables .* conservées 10 ans et les autres données 5 ans/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Vos droits" })).toBeVisible();

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});
