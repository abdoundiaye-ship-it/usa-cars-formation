import { expect, test, type Locator, type Page } from "@playwright/test";
import { databaseAvailable, expectNoHorizontalScroll, signIn } from "./helpers";

// Phase 2 — un dossier fictif traité de l'ouverture à l'arrivée à Dakar (objectif de validation de la phase 2) :
// US-2.2 à US-2.7 sur le dossier DEMO-2026-0001 ; depuis le lot 3d, les étapes financières sont réelles (devis,
// facture d'acompte, paiement 1, facture de solde) au lieu des confirmations manuelles P1.
test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Parcours avec état partagé : exécutés une seule fois (desktop).");
  test.skip(!(await databaseAvailable(request)), "Supabase local non démarré.");
});

const PDF = {
  name: "signe.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
};

/** Ouvre un panneau repliable (<details>) quel que soit son état précédent. */
const openPanel = (scope: Locator) =>
  scope
    .locator("details")
    .first()
    .evaluate((details) => ((details as HTMLDetailsElement).open = true));

/**
 * Document financier émis : si la génération du fichier a été interrompue (démarrage à froid de la fonction),
 * l'application propose « Générer le fichier » ; on relance jusqu'à obtenir le lien de téléchargement.
 */
async function ensureFile(document: Locator) {
  await expect(document).toBeVisible({ timeout: 30_000 });
  const download = document.getByRole("link", { name: "Télécharger (Word)" });
  for (let attempt = 0; attempt < 3 && !(await download.isVisible()); attempt++) {
    await document.getByRole("button", { name: "Générer le fichier" }).click();
    await download.waitFor({ timeout: 30_000 }).catch(() => undefined);
  }
  await expect(download).toBeVisible();
}

/** Section de la fiche dossier, repérée par son titre. */
const section = (page: Page, title: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });

test("agent : de l’ouverture à l’arrivée à Dakar (contrat, ordre d’achat, enchère, conteneur, ATA)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signIn(page, "ops@exemple.test");
  await page.goto("/dossiers?q=DEMO-2026-0001");
  await page.getByRole("link", { name: "DEMO-2026-0001" }).click();
  await page.waitForURL(/\/dossiers\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier DEMO-2026-0001");

  // Contrat généré puis signé (prérequis de l'étape Ouverture)
  const contract = section(page, "Contrat de prestation");
  await contract.getByRole("button", { name: "Générer le contrat" }).click();
  await expect(contract.getByText("En attente de signature")).toBeVisible({ timeout: 30_000 });
  await contract.getByLabel("Contrat signé scanné").setInputFiles(PDF);
  await contract.getByRole("button", { name: "Enregistrer la décision du client" }).click();
  await expect(contract.getByText("Accepté par le client")).toBeVisible();

  // US-2.3 — ordre d'achat : saisie, génération, signature avec les 4 confirmations
  const order = section(page, "Ordre d’achat (annexe B)");
  await expect(order.getByText(/Âge du véhicule conforme/)).toBeVisible();
  await order.getByLabel("Enchère maximale (USD)").fill("12 450");
  await order.getByLabel("Dépôt attendu (USD)").fill("3000");
  await order.getByRole("button", { name: "Enregistrer et générer l’ordre d’achat" }).click();
  await expect(order.getByText("Ordre d’achat généré.")).toBeVisible({ timeout: 30_000 });
  await expect(order.getByRole("link", { name: "Télécharger l’ordre d’achat (Word)" })).toBeVisible();

  await order.getByLabel("Ordre d’achat signé scanné").setInputFiles(PDF);
  await order.getByRole("checkbox", { name: /a pris connaissance/ }).check();
  await order.getByRole("checkbox", { name: /a vérifié que l’âge/ }).check();
  await order.getByRole("button", { name: "Enregistrer la décision sur l’ordre d’achat" }).click();
  await expect(order.getByText(/Le client doit avoir coché les 4 confirmations/)).toBeVisible(); // deux cases manquent
  // Après une erreur, la saisie reste en place, fichier joint compris : il suffit de cocher les cases manquantes.
  for (const name of [/a pris connaissance/, /a vérifié que l’âge/, /lot remporté l’engage/, /droits et taxes/]) {
    await order.getByRole("checkbox", { name }).check();
  }
  await order.getByRole("button", { name: "Enregistrer la décision sur l’ordre d’achat" }).click();
  await expect(order.getByText("Signé", { exact: true })).toBeVisible();

  // US-2.5 — Ouverture → Achat : toutes les conditions sont remplies
  const stage = section(page, "Passage à l’étape suivante");
  await expect(stage.getByText("✗")).toHaveCount(0);
  await stage.getByRole("button", { name: "Passer à l’étape Achat" }).click();
  await expect(page.getByText("Enchère en cours").first()).toBeVisible();

  // US-2.4 — prix au-dessus de l'enchère maximale : refusé à l'agent ; puis lot remporté
  const auction = section(page, "Enchère");
  await auction.getByLabel("Prix d’adjudication (USD)").fill("13 000");
  await auction.getByLabel("Notification du lot remporté (Dakar)").fill("2026-10-19T10:00");
  await auction.getByRole("button", { name: "Enregistrer le résultat de l’enchère" }).click();
  await expect(auction.getByText(/validation de l’administrateur obligatoire/)).toBeVisible();
  await auction.getByLabel("Prix d’adjudication (USD)").fill("12 000");
  await auction.getByLabel("Notification du lot remporté (Dakar)").fill("2026-10-19T10:00");
  await auction.getByRole("button", { name: "Enregistrer le résultat de l’enchère" }).click();
  await expect(auction.getByText("Échéance du paiement 1")).toBeVisible();
  await expect(auction.getByText("20/10/2026 10:00")).toBeVisible(); // notification + 24 h (R4)

  // Phase 3 — conditions financières vérifiées automatiquement (fin de P1) : devis accepté et paiement 1 reçu
  await expect(stage.getByRole("button", { name: "Passer à l’étape Transport USA" })).toBeDisabled();
  const dossierUrl = page.url();
  const forfaits = section(page, "Forfaits et coûts internes");
  await forfaits.getByLabel("Forfait A — acquisition (USD)").fill("12 500");
  await forfaits.getByLabel("Forfait B — logistique et maritime (USD)").fill("3 000");
  await forfaits.getByLabel("Prime d’assurance C (USD, facultative)").fill("250");
  await forfaits.getByRole("button", { name: "Enregistrer les forfaits" }).click();
  await expect(forfaits.getByText("Forfaits enregistrés.")).toBeVisible();
  const billing = section(page, "Devis, dépôt et facture d’acompte");
  await billing.getByRole("button", { name: "Émettre le devis" }).click();
  const quote = billing.getByRole("article", { name: /^Devis DV-/ });
  await ensureFile(quote);
  await quote.getByLabel("Accepte l’assurance").check();
  await quote.getByLabel("Heure de signature").fill(new Date(Date.now() - 60_000).toISOString().slice(11, 16));
  await quote.getByLabel("Devis signé scanné").setInputFiles(PDF);
  await quote.getByRole("button", { name: "Enregistrer la décision sur le devis" }).click();
  await expect(quote.getByText("Accepté par le client")).toBeVisible({ timeout: 30_000 });

  // La comptabilité facture l'acompte et enregistre le paiement 1, puis l'agent reprend le dossier.
  await page.context().clearCookies();
  await signIn(page, "compta@exemple.test");
  await page.goto(dossierUrl);
  await section(page, "Devis, dépôt et facture d’acompte")
    .getByRole("button", { name: "Émettre la facture d’acompte" })
    .click();
  await ensureFile(
    section(page, "Devis, dépôt et facture d’acompte").getByRole("article", { name: /^Facture d’acompte FA-/ }),
  );
  const settlement = section(page, "Paiements, solde et remboursements");
  await settlement.getByText("Enregistrer un paiement…").click();
  await settlement.getByLabel("Montant reçu (USD)").fill("12 500");
  await settlement.getByLabel("Référence du paiement").fill("DEMO-VIR-P1");
  await settlement.getByLabel("Justificatif", { exact: true }).setInputFiles(PDF);
  await settlement.getByRole("button", { name: "Enregistrer le paiement" }).click();
  await expect(page.getByText("Paiement enregistré.")).toBeVisible({ timeout: 30_000 });
  await page.context().clearCookies();
  await signIn(page, "ops@exemple.test");
  await page.goto(dossierUrl);

  const documents = section(page, "Documents");
  await openPanel(documents);
  await documents.getByLabel("Type de document").selectOption("auction_invoice");
  await documents.getByLabel("Fichier").setInputFiles({ ...PDF, name: "facture-copart.pdf" });
  await documents.getByRole("button", { name: "Ajouter le document" }).click();
  await expect(documents.getByRole("link", { name: "Facture d’enchère" })).toBeVisible();

  await expect(stage.getByText("✗")).toHaveCount(0);
  await stage.getByRole("button", { name: "Passer à l’étape Transport USA" }).click();
  await expect(page.getByText("Enlèvement à planifier").first()).toBeVisible();
  await expect(page.getByText("Lot remporté", { exact: true })).toBeVisible(); // chronologie

  // Transport USA → Conteneur : reçu au port et preuve de prise en charge
  await stage.getByLabel("Statut dans l’étape").selectOption("received_at_port");
  await stage.getByRole("button", { name: "Enregistrer le statut" }).click();
  await expect(stage.getByLabel("Statut dans l’étape")).toHaveValue("received_at_port");
  await openPanel(documents);
  await documents.getByLabel("Type de document").selectOption("pickup_proof");
  await documents.getByLabel("Fichier").setInputFiles({ ...PDF, name: "prise-en-charge.pdf" });
  await documents.getByRole("button", { name: "Ajouter le document" }).click();
  await expect(documents.getByRole("link", { name: "Preuve de prise en charge" })).toBeVisible();
  await stage.getByRole("button", { name: "Passer à l’étape Conteneur" }).click();
  await expect(page.getByText("Chargement planifié").first()).toBeVisible();

  // US-2.6 — création d'un conteneur (numéro ISO 6346 contrôlé)
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("link", { name: "Conteneurs" })
    .click();
  await page.getByRole("link", { name: "Nouveau conteneur" }).click();
  await page.getByLabel("Numéro du conteneur").fill("MSKU9070324");
  await page.getByLabel("Transporteur").selectOption({ label: "Transporteur Démo (fictif)" });
  await page.getByLabel("N° de B/L").fill("DEMO-BL-0099");
  await page.getByLabel("Navire").fill("Navire Démo");
  await page.getByLabel("Voyage").fill("DEMO-099");
  await page.getByLabel("ETA indicative").fill("2026-11-20");
  await page.getByRole("button", { name: "Créer le conteneur" }).click();
  await expect(page.getByText(/ISO 6346/).first()).toBeVisible();
  await expect(page.getByLabel("Numéro du conteneur")).toHaveValue("MSKU9070324"); // saisie conservée
  await page.getByLabel("Numéro du conteneur").fill("msku 907032-3");
  await page.getByRole("button", { name: "Créer le conteneur" }).click();
  await page.waitForURL(/\/conteneurs\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conteneur MSKU9070323");
  await expect(page.getByText("ETA indicative : 20/11/2026")).toBeVisible();
  const containerUrl = page.url();

  // B4 — le véhicule est associé au conteneur depuis son dossier
  await page.goto(dossierUrl);
  const box = section(page, "Conteneur");
  await box.getByLabel("Conteneur", { exact: true }).selectOption({ label: "MSKU9070323" });
  await box.getByRole("button", { name: "Associer au conteneur" }).click();
  await expect(box.getByRole("link", { name: "MSKU9070323" })).toBeVisible();
  await expect(box.getByText("ETA indicative : 20/11/2026")).toBeVisible();

  // Facture de solde émise par la comptabilité (après embarquement : B/L et ETA), puis Conteneur → Maritime
  await page.context().clearCookies();
  await signIn(page, "compta@exemple.test");
  await page.goto(dossierUrl);
  await section(page, "Paiements, solde et remboursements")
    .getByRole("button", { name: "Émettre la facture de solde" })
    .click();
  await ensureFile(
    section(page, "Paiements, solde et remboursements").getByRole("article", { name: /^Facture de solde FS-/ }),
  );
  await page.context().clearCookies();
  await signIn(page, "ops@exemple.test");
  await page.goto(dossierUrl);
  await expect(stage.getByText("✗")).toHaveCount(0);
  await stage.getByRole("button", { name: "Passer à l’étape Maritime" }).click();
  await expect(page.getByText("Réservation confirmée").first()).toBeVisible();

  // US-2.7 — départ, ETA modifiée avec sa source, transbordement, vérification, ATA
  await page.goto(containerUrl);
  await page.getByLabel("Date de départ du navire").fill("2026-10-10");
  await page.getByRole("button", { name: "Enregistrer le départ" }).click();
  await expect(page.getByText("En transit").first()).toBeVisible();
  await page.getByLabel("Nouvelle ETA indicative").fill("2026-11-25");
  await page.getByLabel("Source", { exact: true }).selectOption("carrier_site");
  await page.getByRole("button", { name: "Enregistrer l’ETA indicative" }).click();
  await expect(page.getByText("ETA indicative : 25/11/2026")).toBeVisible();
  await expect(page.getByText("ETA indicative modifiée : 20/11/2026 → 25/11/2026")).toBeVisible();
  await page.getByText("Ajouter un événement…").click();
  await page.getByLabel("Type").selectOption("transshipment");
  await page.getByLabel("Source de l’information").selectOption("manual"); // R12 : source distinguée
  await page.getByLabel("Description").fill("Transbordement à Algeciras (démo)");
  await page.getByRole("button", { name: "Ajouter l’événement" }).click();
  await expect(page.getByText("Transbordement à Algeciras (démo)").first()).toBeVisible();
  await expect(page.getByText(/· Saisie manuelle · visible du client/).first()).toBeVisible();
  await page.getByRole("button", { name: "Vérifié aujourd’hui" }).click();
  await expect(page.getByText(/Dernière vérification : \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await page.getByLabel("Date d’arrivée réelle (ATA)").fill("2026-10-18");
  await page.getByRole("button", { name: "Enregistrer l’arrivée (ATA)" }).click();
  await expect(page.getByText("Arrivé le 18/10/2026 (ATA)")).toBeVisible();
  await expect(page.getByText(/ETA indicative :/)).toHaveCount(0); // l'ETA n'est plus affichée après l'ATA

  // Le statut « Arrivé » s'est propagé au dossier ; Maritime → Dakar
  await page.goto(dossierUrl);
  await expect(stage.getByLabel("Statut dans l’étape")).toHaveValue("arrived");
  await expect(
    page.getByText("ETA indicative modifiée : 20/11/2026 → 25/11/2026 (conteneur MSKU9070323)"),
  ).toBeVisible();
  await stage.getByRole("button", { name: "Passer à l’étape Dakar" }).click();
  await expect(page.getByText("Documents à finaliser").first()).toBeVisible();

  // Contrat art. 17 : sans message réellement envoyé, l'agent enregistre l'information donnée au client.
  const arrival = page.locator("section").filter({ has: page.getByRole("heading", { name: "Arrivée à Dakar" }) });
  await expect(arrival.getByText("Le client n’a pas encore été informé de l’arrivée")).toBeVisible();
  await arrival.getByLabel("Client informé par").selectOption("phone");
  await arrival.getByLabel("Précision (facultatif)").fill("Appel du client (démo)");
  await arrival.getByRole("button", { name: "Enregistrer l’information du client" }).click();
  await expect(
    page.getByText("Client informé de l’arrivée par téléphone : Appel du client (démo)").first(),
  ).toBeVisible();
  await expect(arrival.getByText("Le client n’a pas encore été informé de l’arrivée")).toHaveCount(0);

  await page.setViewportSize({ width: 400, height: 800 });
  await expectNoHorizontalScroll(page);
  await page.goto(containerUrl);
  await expectNoHorizontalScroll(page);
});
