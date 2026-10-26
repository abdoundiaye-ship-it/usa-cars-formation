import { expect, test } from "@playwright/test";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 2, lot 2d — US-2.9 (tableau de bord) et US-2.8 (documents), sur les données du seed de démonstration.
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

test("tableau de bord : liste « À traiter » par gravité, indicateurs, progression calendaire", async ({ page }) => {
  await signIn(page, "ops@exemple.test");
  await expect(page).toHaveURL(/\/tableau-de-bord/);

  const todo = page.locator("section").filter({ has: page.getByRole("heading", { name: "À traiter", exact: true }) });
  const overdue = todo
    .getByRole("listitem")
    .filter({ hasText: "DEMO-2026-0003" })
    .filter({ hasText: "Paiement 1 en retard" });
  await expect(overdue).toBeVisible();
  await expect(overdue.getByText("Urgent")).toBeVisible();
  await expect(todo.getByRole("listitem").filter({ hasText: "DEMU7654322" })).toContainText("suivi à vérifier");
  // Tri par gravité : l'urgent avant « À faire »
  await expect(todo.getByRole("listitem").first()).toContainText("Urgent");

  await expect(page.getByText("Paiements 1 en retard")).toBeVisible();
  await expect(page.getByText("pas une position GPS")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /DEMU7654322/ })).toBeVisible();

  await overdue.getByRole("link", { name: "DEMO-2026-0003" }).click();
  await page.waitForURL(/\/dossiers\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier DEMO-2026-0003");

  await page.goto("/tableau-de-bord");
  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("documents : ajout depuis le dossier, filtre par type, bascule visible du client", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, "ops@exemple.test");
  await page.goto("/dossiers?q=DEMO-2026-0002");
  await page.getByRole("link", { name: "DEMO-2026-0002" }).click();
  await page.waitForURL(/\/dossiers\/[0-9a-f-]{36}/, { timeout: 30_000 });

  const documents = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Documents", exact: true }) });
  await documents
    .locator("details")
    .first()
    .evaluate((details) => ((details as HTMLDetailsElement).open = true));
  await documents.getByLabel("Type de document").selectOption("title");
  await documents.getByLabel("Fichier").setInputFiles({
    name: "titre-demo.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await documents.getByRole("button", { name: "Ajouter le document" }).click();
  await expect(documents.getByRole("link", { name: "Titre du véhicule" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("link", { name: "Documents" })
    .click();
  await page.getByLabel("Type de document").selectOption("title");
  await page.getByRole("button", { name: "Filtrer" }).click();
  const row = page.getByRole("row").filter({ hasText: "titre-demo.pdf" });
  await expect(row).toContainText("DEMO-2026-0002");
  await expect(row.getByText("Interne")).toBeVisible();
  await row.getByRole("button", { name: /Rendre visible du client/ }).click();
  await expect(row.getByText("Visible", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("direction : documents en consultation seulement", async ({ page }) => {
  await signIn(page, "direction@exemple.test");
  await page.goto("/documents");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Documents");
  await expect(page.getByRole("button", { name: /Rendre (visible|interne)/ })).toHaveCount(0);
});
