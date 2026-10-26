import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, databaseAvailable, expectNoHorizontalScroll, freshTotp, signIn } from "./helpers";

// Phase 1 — US-1.0 à US-1.4 sur les comptes du seed de démonstration (Supabase local).
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

test("mot de passe incorrect : message explicite", async ({ page }) => {
  await signIn(page, "ops@exemple.test", "MauvaisMotDePasse1", { expectRedirect: false });
  // Next.js ajoute sa propre zone role="alert" (annonceur de navigation) : on cible le message.
  await expect(page.getByRole("alert").filter({ hasText: "E-mail ou mot de passe incorrect." })).toBeVisible();
  await expect(page).toHaveURL(/\/connexion$/);
});

test("agent opérations : pas d’accès à l’audit ni à la gestion des utilisateurs", async ({ page }) => {
  await signIn(page, "ops@exemple.test");
  await expect(page).toHaveURL(/\/tableau-de-bord/);
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link", { name: "Paramètres" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Journal d’audit" })).toHaveCount(0);

  await page.goto("/audit");
  await expect(page).toHaveURL(/\/acces-refuse/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accès refusé");

  await page.goto("/utilisateurs");
  await expect(page).toHaveURL(/\/acces-refuse/);
});

test("agent opérations : paramètres en lecture seule, valeurs à confirmer signalées", async ({ page }) => {
  await signIn(page, "ops@exemple.test");
  await page.goto("/parametres");
  await expect(page.getByText(/paramètres? .*encore à confirmer/)).toBeVisible();
  await page.getByRole("link", { name: "Validité du devis (heures)" }).click();
  await expect(page.getByText("Valeur en vigueur")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer la nouvelle version" })).toHaveCount(0);
});

test("comptabilité : la double authentification est exigée (A4)", async ({ page }) => {
  // Connexion par mot de passe seul (sans la session partagée de global-setup) : le code reste demandé.
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill("compta@exemple.test");
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/connexion\/mfa/);
  await expect(page.getByLabel("Code à 6 chiffres")).toBeVisible();

  await page.goto("/tableau-de-bord");
  await expect(page).toHaveURL(/\/connexion\/mfa/);
});

test.describe("administrateur", () => {
  test.describe.configure({ retries: 0 }); // l’enrôlement MFA n’a lieu qu’une fois par base

  test("configure sa MFA, crée un utilisateur par lien d’accès et retrouve l’action dans l’audit", async ({
    page,
    browser,
  }) => {
    await signIn(page, "admin@exemple.test");
    await expect(page).toHaveURL(/\/connexion\/mfa/);

    await page.getByRole("button", { name: "Configurer la double authentification" }).click();
    const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
    expect(secret).not.toBe("");
    await page.getByLabel("Code à 6 chiffres").fill(await freshTotp(secret));
    await page.getByRole("button", { name: "Valider le code" }).click();
    await expect(page).toHaveURL(/\/tableau-de-bord/);

    // US-1.2 : invitation d'un utilisateur avec un rôle
    const email = `agent.${Date.now()}@exemple.test`;
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "Utilisateurs" })
      .click();
    await page.getByLabel("Nom complet").fill("Agent Parcours (démo)");
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Rôle", { exact: true }).selectOption("ops");
    await page.getByRole("button", { name: "Créer le compte", exact: true }).click();
    await expect(page.getByText(`Compte créé pour ${email}.`)).toBeVisible();
    const link = await page.getByLabel("Lien d’accès").inputValue();
    expect(link).toContain("/auth/confirm?token_hash=");
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row.getByText("Invitation envoyée")).toBeVisible();

    // La personne invitée ouvre le lien (autre navigateur) et choisit son mot de passe, sans aucun e-mail.
    const invitee = await browser.newContext();
    const inviteePage = await invitee.newPage();
    await inviteePage.goto(link);
    await expect(inviteePage).toHaveURL(/\/compte\/mot-de-passe/);
    await inviteePage.getByLabel("Nouveau mot de passe").fill("AgentParcours2026");
    await inviteePage.getByLabel("Confirmez le mot de passe").fill("AgentParcours2026");
    await inviteePage.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
    await expect(inviteePage).toHaveURL(/\/tableau-de-bord/);
    await invitee.close();

    // Un lien déjà utilisé ne fonctionne plus.
    const replay = await browser.newContext();
    const replayPage = await replay.newPage();
    await replayPage.goto(link);
    await expect(replayPage).toHaveURL(/\/connexion\?erreur=lien/);
    await replay.close();

    // Changement de rôle journalisé (avant / après)
    await row.getByLabel("Rôle de Agent Parcours (démo)").selectOption("accounting");
    await row.getByRole("button", { name: "Enregistrer le rôle" }).click();
    await expect(row.getByText("Rôle enregistré.")).toBeVisible();

    // US-1.4 : l'audit montre l'auteur et le changement
    await page.goto("/audit?objet=profiles&action=update");
    const entry = page.getByRole("row").filter({ hasText: "Agent Parcours (démo)" }).first();
    await expect(entry).toContainText("Awa Admin (démo)");
    await expect(entry).toContainText("Agent opérations → Comptabilité");
    await expectNoHorizontalScroll(page);
  });
});
