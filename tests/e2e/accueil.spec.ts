import { expect, test } from "@playwright/test";
import { databaseAvailable, expectNoHorizontalScroll } from "./helpers";

test("l’accueil renvoie vers la connexion, en français et sans défilement horizontal", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/connexion/);
  await expect(page).toHaveTitle(/Connexion · USA CARS/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connexion");
  await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("une page interne sans session renvoie vers la connexion", async ({ page }) => {
  await page.goto("/parametres");
  await expect(page).toHaveURL(/\/connexion\?suite=%2Fparametres/);
});

test("la base de données locale répond (CI)", async ({ request }) => {
  test.skip(!process.env.CI, "Vérifié en CI, où Supabase local est démarré.");
  expect(await databaseAvailable(request)).toBe(true);
});
