import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Cookie, type Page } from "@playwright/test";

/** Mot de passe commun des comptes du seed de démonstration (local uniquement, supabase/seed.sql). */
export const DEMO_PASSWORD = "DemoUsaCars2026";

/** Code TOTP (RFC 6238 : SHA-1, 6 chiffres, pas de 30 s) à partir d’une clé base32. */
export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretBase32.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/**
 * Code TOTP utilisable sans risque : s'il ne reste que quelques secondes dans la fenêtre de 30 s, attend la
 * suivante (sinon le code peut expirer entre sa génération et sa vérification — test instable).
 */
export async function freshTotp(secretBase32: string): Promise<string> {
  const secondsInWindow = (Date.now() / 1000) % 30;
  if (secondsInWindow > 25) await new Promise((resolve) => setTimeout(resolve, (30 - secondsInWindow) * 1000 + 500));
  return totp(secretBase32);
}

/** Comptes du seed dont le facteur TOTP est déjà vérifié (secret de démonstration, décisions A4 et A4-bis). */
export const DEMO_TOTP_SECRETS: Record<string, string> = {
  "compta@exemple.test": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "direction@exemple.test": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
};

/** Session enregistrée par `global-setup.ts` pour un compte à facteur TOTP de démonstration. */
export function demoSessionPath(email: string): string {
  return path.join("playwright", ".auth", `${email}.json`);
}

/**
 * Connexion ; attend la redirection (sauf `expectRedirect: false`, ex. mot de passe incorrect). Un compte à
 * facteur TOTP de démonstration reprend la session ouverte une fois pour toutes par `global-setup.ts`.
 */
export async function signIn(page: Page, email: string, password = DEMO_PASSWORD, { expectRedirect = true } = {}) {
  if (DEMO_TOTP_SECRETS[email]) {
    const state = JSON.parse(readFileSync(demoSessionPath(email), "utf8")) as { cookies: Cookie[] };
    await page.context().addCookies(state.cookies);
    await page.goto("/");
    await page.waitForURL((url) => !url.pathname.startsWith("/connexion") && url.pathname !== "/");
    return;
  }
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  if (expectRedirect) await page.waitForURL((url) => url.pathname !== "/connexion");
}

/** Les parcours authentifiés exigent Supabase local démarré (toujours le cas en CI). */
export async function databaseAvailable(request: APIRequestContext): Promise<boolean> {
  const response = await request.get("/api/sante");
  return response.ok();
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
}
