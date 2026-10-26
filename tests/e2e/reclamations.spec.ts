import { expect, test, type Page } from "@playwright/test";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 6, lot 6d — US-6.3 (réclamations après l'enlèvement, contrat art. 19) : dépôt par l'agent puis par le
// client, traitement par l'agent avec information du client, isolement des coûts internes (règle 2).
// Dossier de démonstration DEMO-2026-0009 (client Mamadou Diallo, client@exemple.test), déjà « Enlevé ».
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});
test.describe.configure({ mode: "serial", retries: 0 }); // les réclamations s'accumulent au fil des tests

const section = (page: Page, title: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });

test("agent : dépose une réclamation pour le client puis la traite", async ({ page }) => {
  await signIn(page, "ops@exemple.test");
  await page.goto("/dossiers?q=DEMO-2026-0009");
  await page.getByRole("link", { name: "DEMO-2026-0009" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier DEMO-2026-0009");

  const claims = section(page, "Réclamations");
  await claims.getByLabel("Réserves (constat, dommages)").fill("Pare-chocs avant rayé constaté à l’enlèvement.");
  await claims.getByRole("button", { name: "Enregistrer la réclamation" }).click();

  const item = claims.locator("li").filter({ hasText: "Pare-chocs avant rayé" });
  await expect(item).toBeVisible({ timeout: 30_000 });
  // Le statut est aussi une option du formulaire de traitement : on le lit sur le sélecteur, sans ambiguïté.
  await expect(item.getByLabel("Statut")).toHaveValue("open");
  await expect(item.getByText("Dans le délai", { exact: true })).toBeVisible();
  await expect(item).toContainText("Déposée par USA CARS");

  // Traitement : statut + réponse communiquée au client.
  await item.getByLabel("Statut").selectOption({ label: "Résolue" });
  await item
    .getByLabel("Réponse au client (facultatif)")
    .fill("Un dédommagement a été convenu avec l’assureur ; dossier clos.");
  await item.getByRole("button", { name: "Mettre à jour" }).click();
  await expect(claims.getByText("Réclamation mise à jour ; le client est informé.")).toBeVisible({ timeout: 30_000 });
  await expect(item.getByLabel("Statut")).toHaveValue("resolved");

  // US-4.5 : le client est notifié (template « claim_update ») sur ses deux canaux (e-mail + WhatsApp), sans détail sensible.
  await page.goto("/notifications");
  const rows = page
    .getByRole("row")
    .filter({ hasText: "Réponse à une réclamation" })
    .filter({ hasText: "Mamadou Diallo" });
  await expect(rows).toHaveCount(2);
});

test("client : suit la réponse et dépose sa propre réclamation", async ({ page }) => {
  await signIn(page, "client@exemple.test");
  await expect(page).toHaveURL(/\/espace$/);
  await page.getByRole("link", { name: "Voir le dossier DEMO-2026-0009" }).click();

  const claims = section(page, "Réclamations");
  const agentItem = claims.locator("li").filter({ hasText: "Pare-chocs avant rayé" });
  await expect(agentItem.getByText("Résolue", { exact: true })).toBeVisible();
  await expect(agentItem).toContainText("Réponse de USA CARS");
  await expect(agentItem).toContainText("dédommagement a été convenu");
  // Règle 2 : aucun coût interne ni marge ni prix d'adjudication dans le portail.
  await expect(page.getByText(/marge|coût interne|Prix d’adjudication/i)).toHaveCount(0);

  await claims.getByLabel("Décrivez le problème constaté").fill("Le rétroviseur droit ne tient plus.");
  await claims.getByRole("button", { name: "Envoyer la réclamation" }).click();
  await expect(claims.getByText("Votre réclamation a été envoyée à USA CARS.")).toBeVisible({ timeout: 30_000 });
  const clientItem = claims.locator("li").filter({ hasText: "rétroviseur droit" });
  await expect(clientItem.getByText("Reçue", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
});
