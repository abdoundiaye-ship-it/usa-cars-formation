import { expect, test } from "@playwright/test";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Refonte de l'interface : cadre interne (menu latéral par activité, barre supérieure) et recherche globale.
test.beforeEach(async ({ request }) => {
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

test("menu latéral groupé par activité et recherche globale (ordinateur)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours ordinateur.");
  await signIn(page, "ops@exemple.test");
  await expect(page).toHaveURL(/\/tableau-de-bord/);

  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link", { name: "Tableau de bord" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Conteneurs" })).toBeVisible();

  // Recherche globale : un dossier fictif par sa référence.
  await page.getByRole("searchbox", { name: "Rechercher" }).first().fill("DEMO-2026-0007");
  await page.getByRole("searchbox", { name: "Rechercher" }).first().press("Enter");
  await expect(page).toHaveURL(/\/recherche\?q=DEMO-2026-0007/);
  // Le dossier recherché apparaît dans la section « Dossiers » et pointe vers sa fiche (l'ouverture est couverte ailleurs).
  const dossiers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Dossiers" }) });
  await expect(dossiers.getByRole("link", { name: /DEMO-2026-0007/ })).toHaveAttribute(
    "href",
    /\/dossiers\/[0-9a-f-]{36}/,
  );
});

test("menu en tiroir sur téléphone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-400", "Parcours téléphone (400 px).");
  await signIn(page, "ops@exemple.test");
  await expect(page).toHaveURL(/\/tableau-de-bord/);

  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link", { name: "Dossiers" })).toBeHidden(); // tiroir fermé
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(nav.getByRole("link", { name: "Dossiers" })).toBeVisible();
  await page.getByRole("button", { name: "Fermer le menu" }).click();
  await expect(nav.getByRole("link", { name: "Dossiers" })).toBeHidden();

  await expectNoHorizontalScroll(page);
});

test("recherche : client trouvé par son nom, aucun résultat signalé", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours ordinateur.");
  await signIn(page, "ops@exemple.test");

  await page.goto("/recherche?q=Diallo");
  const clients = page.locator("section").filter({ has: page.getByRole("heading", { name: "Clients" }) });
  await expect(clients.getByRole("link", { name: /Diallo/ })).toBeVisible();

  await page.goto("/recherche?q=ZZZINTROUVABLE");
  await expect(page.getByText(/Aucun résultat/)).toBeVisible();
});
