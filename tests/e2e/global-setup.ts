import { chromium, type FullConfig } from "@playwright/test";
import { DEMO_PASSWORD, DEMO_TOTP_SECRETS, demoSessionPath, freshTotp } from "./helpers";

/**
 * Comptes à double authentification de démonstration (décision A4-bis) : une seule connexion avant les tests,
 * session partagée ensuite. Des connexions parallèles au même compte s'annuleraient : la validation du second
 * facteur par une session ferme les autres sessions du compte (Supabase Auth).
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const browser = await chromium.launch();
  try {
    for (const [email, secret] of Object.entries(DEMO_TOTP_SECRETS)) {
      const context = await browser.newContext({ baseURL, locale: "fr-FR" });
      const page = await context.newPage();
      const health = await page.request.get("/api/sante").catch(() => null);
      if (!health?.ok()) {
        await context.close();
        return; // Supabase local non démarré : les parcours authentifiés seront ignorés.
      }
      await page.goto("/connexion");
      await page.getByLabel("Adresse e-mail").fill(email);
      await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await page.waitForURL((url) => url.pathname === "/connexion/mfa", { timeout: 60_000 });
      await page.getByLabel("Code à 6 chiffres").fill(await freshTotp(secret));
      await page.getByRole("button", { name: "Valider le code" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/connexion"), { timeout: 60_000 });
      await context.storageState({ path: demoSessionPath(email) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
