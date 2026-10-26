import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import PizZip from "pizzip";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 6, lot 6a — US-6.1 : rapports par rôle et export Excel (P6-1). Marge réservée à l'administrateur et à
// la direction (Q2) : DEMO-2026-0007 a des coûts internes fictifs (marge 2 450 $US, 18,8 %).
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours exécuté une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

test("direction : marge par véhicule à l’écran et export Excel", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "direction@exemple.test");
  await page.getByRole("link", { name: "Rapports", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rapports");

  const tabs = page.getByRole("navigation", { name: "Rapports" });
  await tabs.getByRole("link", { name: "Marge par véhicule" }).click();
  await page.getByLabel("Du").fill("2026-01-01");
  await page.getByRole("button", { name: "Afficher" }).click();
  await expect(page.getByText(/Confidentiel : coûts internes et marge/)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "DEMO-2026-0007" });
  await expect(row).toContainText("18,8 %");
  await expect(page.getByRole("row").filter({ hasText: "DEMO-2026-0005" })).toContainText("—"); // sans coût saisi

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger (Excel)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^USA-CARS-margins-2026-01-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const zip = new PizZip(readFileSync(await download.path()));
  const sheet = zip.file("xl/worksheets/sheet1.xml")!.asText();
  expect(sheet).toContain("DEMO-2026-0007");
  expect(sheet).toContain("Marge %");

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("agent opérations : rapports opérationnels seulement, marge refusée", async ({ page }) => {
  await signIn(page, "ops@exemple.test");
  await page.goto("/rapports?rapport=margins");
  const tabs = page.getByRole("navigation", { name: "Rapports" });
  await expect(tabs.getByRole("link")).toHaveText(["Dossiers actifs", "Retards", "Délais achat → Dakar"]);
  await expect(page.getByRole("heading", { level: 2, name: "Dossiers actifs" })).toBeVisible(); // pas la marge

  await page.goto("/rapports/export?rapport=margins&du=2026-01-01&au=2026-12-31");
  await expect(page).toHaveURL(/\/acces-refuse/);
});
