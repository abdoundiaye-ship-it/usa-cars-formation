/**
 * Prépare les modèles balisés (pnpm templates:generate) — docs/16_documents_generes.md.
 *
 * Source : reference/templates/USA_CARS_Contrat_Prestation_Services_Senegal_-_Revise.docx (jamais modifié).
 * Sorties (syntaxe docxtemplater `{champ}`) :
 *   - templates/contrat_prestation.docx : le contrat (en-tête, blocs « USA CARS » et « LE CLIENT », article 3,
 *     signatures balisés) ;
 *   - templates/ordre_achat.docx : l'annexe B seule (ordre d'achat et mandat d'enchère), document signé à part ;
 *   - templates/devis_facture.docx : devis DV et factures FA / FS (modèle « Devis / Facture » révisé), avec le logo
 *     en en-tête (décision D4) et les valeurs contractuelles reprises des paramètres (CLAUDE.md règle 4) ;
 *   - templates/recu.docx : reçu espèces RC et note de remboursement RB (même en-tête, corps d'une page) ;
 *   - templates/courrier.docx : lettre de relance LR et mise en demeure MD (procédure « véhicule non réclamé ») ;
 *   - supabase/functions/_shared/document-templates.generated.ts : les fichiers en base64, embarqués dans la
 *     fonction Supabase generate-document (sans accès au disque).
 *
 * Les valeurs contractuelles surlignées restent celles du modèle jusqu'à la validation juridique (décision D1) ;
 * la mention « PROJET » est ajoutée dans l'en-tête de page. Les 4 confirmations de l'annexe B restent à cocher
 * par le client sur le document signé.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import PizZip from "pizzip";
import { xmlStructureError } from "../lib/documents/well-formed-xml";

const SOURCE = "reference/templates/USA_CARS_Contrat_Prestation_Services_Senegal_-_Revise.docx";
const FINANCIAL_SOURCE = "reference/templates/USA_CARS_Devis_Facture_Client_-_Revise.docx";
const LOGO = "public/logo-usa-cars.png";
const OUTPUT_CONTRACT = "templates/contrat_prestation.docx";
const OUTPUT_PURCHASE_ORDER = "templates/ordre_achat.docx";
const OUTPUT_FINANCIAL = "templates/devis_facture.docx";
const OUTPUT_RECEIPT = "templates/recu.docx";
const OUTPUT_LETTER = "templates/courrier.docx";
const OUTPUT_MODULE = "supabase/functions/_shared/document-templates.generated.ts";

/** Remplace le texte d'un élément <w:t> (texte exact) ; `occurrence` : 1 = première, 2 = deuxième… */
function replaceText(xml: string, from: string, to: string, occurrence = 1): string {
  const needle = `>${from}</w:t>`;
  let index = -1;
  for (let i = 0; i < occurrence; i++) {
    index = xml.indexOf(needle, index + 1);
    if (index < 0) throw new Error(`Texte introuvable dans le modèle (occurrence ${occurrence}) : « ${from} »`);
  }
  return `${xml.slice(0, index)}>${to}</w:t>${xml.slice(index + needle.length)}`;
}

/** Article 3 : insère une balise dans la cellule vide qui suit le libellé (première occurrence = article 3). */
function fillValueCell(xml: string, label: string, tag: string): string {
  const labelIndex = xml.indexOf(`>${label}</w:t>`);
  if (labelIndex < 0) throw new Error(`Libellé introuvable dans le modèle : « ${label} »`);
  const cellStart = xml.indexOf("<w:tc>", labelIndex);
  const emptyParagraphEnd = xml.indexOf("</w:pPr></w:p>", cellStart);
  const cellEnd = xml.indexOf("</w:tc>", cellStart);
  if (cellStart < 0 || emptyParagraphEnd < 0 || emptyParagraphEnd > cellEnd) {
    throw new Error(`Cellule de valeur vide introuvable après « ${label} »`);
  }
  const insertAt = emptyParagraphEnd + "</w:pPr>".length;
  const run = `<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">{${tag}}</w:t></w:r>`;
  return `${xml.slice(0, insertAt)}${run}${xml.slice(insertAt)}`;
}

function tagDocument(xml: string): string {
  let out = xml;
  out = replaceText(
    out,
    "Référence contrat : ____________________    Référence dossier : ____________________    Date : ____ / ____ / ______",
    "Référence contrat : {contrat_reference}    Référence dossier : {dossier_reference}    Date : {date_contrat}",
  );
  // Bloc USA CARS (paramètres company.*)
  out = replaceText(out, "Forme juridique : __________________", "Forme juridique : {usa_forme_juridique}");
  out = replaceText(out, "RCCM : ____________  NINEA : ____________", "RCCM : {usa_rccm}  NINEA : {usa_ninea}");
  out = replaceText(out, "Bureau au Sénégal : __________________", "Bureau au Sénégal : {usa_bureau}");
  out = replaceText(out, "Téléphone officiel : _________________", "Téléphone officiel : {usa_telephone}");
  out = replaceText(out, "E-mail officiel : _____________________", "E-mail officiel : {usa_email}");
  out = replaceText(out, "Représentée par : ____________________", "Représentée par : {usa_representant}");
  out = replaceText(out, "Fonction : _________________________", "Fonction : {usa_representant_fonction}", 1);
  // Bloc LE CLIENT
  out = replaceText(out, "Nom / Société : ______________________", "Nom / Société : {client_nom}");
  out = replaceText(out, "Adresse : ____________________________", "Adresse : {client_adresse}");
  out = replaceText(
    out,
    "Téléphone / WhatsApp de notification : ______________",
    "Téléphone / WhatsApp de notification : {client_telephone}",
  );
  out = replaceText(out, "E-mail : _____________________________", "E-mail : {client_email}");
  out = replaceText(
    out,
    "Pièce d’identité (type et n°) : ______________",
    "Pièce d’identité (type et n°) : {client_piece}",
  );
  out = replaceText(out, "NINEA / RCCM (si société) : ____________", "NINEA / RCCM (si société) : {client_ninea_rccm}");
  out = replaceText(
    out,
    "Représenté par (si société) : _____________",
    "Représenté par (si société) : {client_representant}",
  );
  // Après le remplacement de la première occurrence, celle du client devient la première restante.
  out = replaceText(out, "Fonction : _________________________", "Fonction : {client_representant_fonction}", 1);
  // Article 3 — identification du véhicule
  out = replaceText(out, "☐ COPART   ☐ IAA   ☐ Autre", "{plateforme_cases}", 1);
  for (const [label, tag] of [
    ["N° de lot", "lot"],
    ["VIN / Châssis", "vin"],
    ["Prix d’adjudication (USD)", "prix_adjudication"],
    ["Marque / Modèle", "marque_modele"],
    ["Année", "annee"],
    ["Kilométrage", "kilometrage"],
    ["Statut du titre", "statut_titre"],
    ["Lieu d’achat", "lieu_achat"],
    ["Port prévu", "port_prevu"],
  ] as const) {
    out = fillValueCell(out, label, tag);
  }
  // Article 33 — durées de conservation (décision G2-a : paramètres data.retention_years*, CLAUDE.md règle 4)
  out = replaceText(
    out,
    "______ ans",
    "{conservation_comptable} pour les pièces comptables (devis, factures, reçus, paiements) et {conservation_autres} pour les autres données,",
  );
  // Signatures
  out = replaceText(out, "Nom : ______________________________", "Nom : {usa_representant}", 1);
  out = replaceText(out, "Nom : ______________________________", "Nom : {client_signataire}", 1);
  out = replaceText(out, "Fonction / Société : _________________", "Fonction / Société : {client_signataire_fonction}");
  return out;
}

/** En-tête de page : mention « PROJET » tant que le paramètre templates.legal_validated est faux (D1). */
function tagHeader(xml: string): string {
  const end = xml.lastIndexOf("</w:p>");
  if (end < 0) throw new Error("En-tête de page sans paragraphe.");
  const run =
    '<w:r><w:rPr><w:b/><w:color w:val="C00000"/><w:sz w:val="18"/></w:rPr>' +
    '<w:t xml:space="preserve">{#projet}   —   PROJET : document non validé juridiquement{/projet}</w:t></w:r>';
  return `${xml.slice(0, end)}${run}${xml.slice(end)}`;
}

/** Annexe B seule : du titre « ANNEXE B » jusqu'au titre « ANNEXE C » exclu, sans saut de page. */
function extractAnnexB(xml: string): string {
  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const sectionProperties = xml.lastIndexOf("<w:sectPr");
  const paragraphStart = (marker: string) => {
    const at = xml.indexOf(marker);
    if (at < 0) throw new Error(`Repère introuvable dans le modèle : « ${marker} »`);
    return xml.lastIndexOf("<w:p ", at);
  };
  const annexB = xml.slice(
    paragraphStart(">ANNEXE B – ORDRE D’ACHAT ET MANDAT D’ENCHÈRE<"),
    paragraphStart(">ANNEXE C – CONTENU DES FORFAITS<"),
  );
  return `${xml.slice(0, bodyStart)}${annexB.replaceAll('<w:br w:type="page"/>', "")}${xml.slice(sectionProperties)}`;
}

function tagPurchaseOrder(xml: string): string {
  let out = extractAnnexB(xml);
  out = replaceText(out, "☐ COPART   ☐ IAA   ☐ Autre", "{plateforme_cases}", 1);
  for (const [label, tag] of [
    ["Référence dossier", "dossier_reference"],
    ["Date / heure de l’enchère", "enchere_date"],
    ["N° de lot", "lot"],
    ["VIN", "vin"],
    ["Marque / Modèle / Année", "vehicule"],
    ["Lieu de vente", "lieu_vente"],
    ["Statut du titre annoncé", "statut_titre"],
    ["Enchère maximale (USD)", "enchere_max"],
    ["Dépôt versé (USD)", "depot"],
  ] as const) {
    out = fillValueCell(out, label, tag);
  }
  return out;
}

/** En-tête de page de l'ordre d'achat : titre propre au document et rattachement au contrat. */
function tagPurchaseOrderHeader(xml: string): string {
  let out = replaceText(xml, "| CONTRAT", "| ORDRE D’ACHAT — ANNEXE B DU CONTRAT {contrat_reference}");
  out = replaceText(out, " DE PRESTATION DE SERVICES", "");
  return tagHeader(out);
}

interface BuiltTemplate {
  bytes: Buffer;
  version: string;
}

/** Applique les balises, écrit le .docx et calcule une version stable (sur le contenu balisé, pas sur le zip). */
function build(
  prefix: string,
  output: string,
  tagBody: (xml: string) => string,
  tagHead: (xml: string) => string,
  { source = SOURCE, extra }: { source?: string; extra?: (zip: PizZip) => void } = {},
) {
  const zip = new PizZip(readFileSync(resolve(source)));
  const documentXml = tagBody(zip.file("word/document.xml")!.asText());
  const headerXml = tagHead(zip.file("word/header1.xml")!.asText());
  zip.file("word/document.xml", documentXml);
  zip.file("word/header1.xml", headerXml);
  extra?.(zip);
  for (const [part, xml] of [
    ["word/document.xml", documentXml],
    ["word/header1.xml", headerXml],
  ] as const) {
    const error = xmlStructureError(xml);
    if (error) throw new Error(`${output} : ${part} mal formé (${error}) — Word refuserait d’ouvrir le fichier.`);
  }
  const bytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), bytes);
  const version = `${prefix}-${createHash("sha256").update(documentXml).update(headerXml).digest("hex").slice(0, 12)}`;
  console.log(`✅ ${output} (${bytes.length} octets), version ${version}`);
  return { bytes, version } satisfies BuiltTemplate;
}

// ---------------------------------------------------------------------------
// Devis / facture : le modèle est fait de tableaux dont les espaces réservés se répètent (« ________ ») ;
// on balise donc par paragraphe (texte complet) et par cellule (celle qui suit un libellé), ligne par ligne.
// ---------------------------------------------------------------------------
const PARAGRAPH = /<w:p[ >][\s\S]*?<\/w:p>/g;
const ROW = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
const CELL = /<w:tc>[\s\S]*?<\/w:tc>/g;

const paragraphText = (p: string) => [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
const paragraphsOf = (xml: string) => xml.match(PARAGRAPH) ?? [];

/** Remplace le contenu d'un paragraphe par un seul segment (mise en forme du premier, sans surlignage). */
function setParagraphText(p: string, value: string): string {
  const open = p.match(/^<w:p[^>]*>/)![0];
  const pPr = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const rPr = (p.match(/<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? '<w:rPr><w:sz w:val="18"/></w:rPr>').replace(
    /<w:highlight [^>]*\/>/g,
    "",
  );
  return `${open}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;
}

/** Remplace le n-ième paragraphe dont le texte complet vaut `text` (ou commence par `text` si `prefix`). */
function replaceParagraph(xml: string, text: string, value: string, { occurrence = 1, prefix = false } = {}): string {
  let seen = 0;
  let done = false;
  const out = xml.replace(PARAGRAPH, (p) => {
    const t = paragraphText(p);
    if (done || !(prefix ? t.startsWith(text) : t === text)) return p;
    seen += 1;
    if (seen !== occurrence) return p;
    done = true;
    return setParagraphText(p, value);
  });
  if (!done) throw new Error(`Paragraphe introuvable dans le modèle : « ${text} » (occurrence ${occurrence})`);
  return out;
}

/** Remplace, dans un fragment, le premier paragraphe dont le texte vérifie `match`. */
function replaceIn(fragment: string, match: (text: string) => boolean, value: string): string {
  const p = paragraphsOf(fragment).find((x) => match(paragraphText(x)));
  if (!p) throw new Error(`Paragraphe introuvable dans la ligne : ${match.toString()}`);
  return fragment.replace(p, setParagraphText(p, value));
}

/** Modifie la n-ième ligne de tableau contenant un paragraphe de texte `text`. */
function editRow(xml: string, text: string, edit: (row: string) => string, occurrence = 1): string {
  let seen = 0;
  let done = false;
  const out = xml.replace(ROW, (row) => {
    if (done || !paragraphsOf(row).some((p) => paragraphText(p) === text)) return row;
    seen += 1;
    if (seen !== occurrence) return row;
    done = true;
    return edit(row);
  });
  if (!done) throw new Error(`Ligne introuvable dans le modèle : « ${text} » (occurrence ${occurrence})`);
  return out;
}

/** Dans une ligne : premier paragraphe de la cellule qui suit celle du libellé. */
function setCellAfter(row: string, label: string, value: string): string {
  const cells = row.match(CELL) ?? [];
  const index = cells.findIndex((c) => paragraphsOf(c).some((p) => paragraphText(p) === label));
  if (index < 0 || index + 1 >= cells.length) throw new Error(`Cellule introuvable après « ${label} »`);
  const target = cells[index + 1]!;
  const first = paragraphsOf(target)[0]!;
  return row.replace(target, target.replace(first, setParagraphText(first, value)));
}

/** Libellé → valeur dans la cellule suivante, pour la n-ième ligne qui contient ce libellé. */
function fillAfter(xml: string, label: string, value: string, occurrence = 1): string {
  return editRow(xml, label, (row) => setCellAfter(row, label, value), occurrence);
}

/** Paiements reçus : la première ligne devient une boucle docxtemplater, les deux autres sont supprimées. */
function tagPaymentRows(xml: string): string {
  const rows = xml.match(ROW) ?? [];
  const header = rows.findIndex((r) => r.includes(">Référence / justificatif<"));
  if (header < 0) throw new Error("Tableau des paiements reçus introuvable.");
  const [first, second, third] = rows.slice(header + 1, header + 4);
  const values = ["{#paiements}{date}", "{mode}", "{reference}", "{montant}{/paiements}"];
  let cellIndex = 0;
  const loopRow = first!.replace(CELL, (cell) => {
    const p = paragraphsOf(cell)[0]!;
    return cell.replace(p, setParagraphText(p, values[cellIndex++]!));
  });
  return xml.replace(first!, loopRow).replace(second!, "").replace(third!, "");
}

function tagFinancialDocument(xml: string): string {
  let out = replaceParagraph(xml, "DEVIS / FACTURE CLIENT", "{titre_document}");
  out = replaceParagraph(
    out,
    "USA CARS – [forme juridique]",
    "USA CARS – {usa_forme_juridique} – RCCM : {usa_rccm} – NINEA : {usa_ninea} – {usa_bureau} – Tél. : {usa_telephone} – E-mail : {usa_email}",
    { prefix: true },
  );
  out = editRow(out, "Type de document", (row) => {
    let r = replaceIn(row, (t) => t === "☐ Devis (valable 48 h)", "{case_devis} Devis");
    r = replaceIn(r, (t) => t === "☐ Facture d’acompte (Paiement 1)", "{case_fa} Facture d’acompte (Paiement 1)");
    return replaceIn(r, (t) => t === "☐ Facture de solde", "{case_fs} Facture de solde");
  });
  for (const [label, tag] of [
    ["N° document", "numero"],
    ["Date", "date_document"],
    ["N° contrat", "contrat_reference"],
    ["Référence dossier", "dossier_reference"],
    ["Client", "client_nom"],
    ["Téléphone / WhatsApp", "client_telephone"],
    ["Pièce d’identité / NINEA", "client_piece"],
    ["E-mail", "client_email"],
    ["Marque", "marque"],
    ["Modèle", "modele"],
    ["Année", "annee"],
    ["VIN", "vin"],
    ["Plateforme", "plateforme_cases"],
    ["N° lot", "lot"],
    ["Lieu d’achat", "lieu_achat"],
    ["Port de départ", "port_depart"],
    ["Transporteur", "transporteur"],
    ["Conteneur", "conteneur"],
    ["Navire / voyage", "navire"],
    ["B/L", "bl"],
    ["ETA Dakar (indicative)", "eta"],
    ["Lien de suivi", "lien_suivi"],
    // Section 2 — colonne « Montant USD »
    ["Coût total d’acquisition du véhicule – forfait", "montant_a"],
    ["Logistique et transport maritime vers Dakar – forfait", "montant_b"],
    ["Assurance transport maritime – option à confirmer par le Client", "montant_c"],
    ["Ajustements (facture de solde uniquement)", "montant_d"],
    ["TVA (si applicable) – à confirmer avec l’expert-comptable", "montant_tva"],
  ] as const) {
    out = fillAfter(out, label, `{${tag}}`);
  }
  out = replaceParagraph(out, "TVA (si applicable) – à confirmer avec l’expert-comptable", "{tva_libelle}");
  out = replaceParagraph(
    out,
    "☐ Acceptée – montant ci-contre ajouté au solde      ☐ Refusée – montant : 0 USD",
    "{case_c_acceptee} Acceptée – montant ci-contre ajouté au solde      {case_c_refusee} Refusée – montant : 0 USD",
  );
  out = replaceParagraph(
    out,
    "Frais supplémentaires hors forfait justifiés (article 26 du contrat) ;",
    "Frais supplémentaires hors forfait justifiés (article 26 du contrat) ; frais de retard : {frais_retard} par période de {frais_retard_jours} jours commencée ; remise éventuelle.",
    { prefix: true },
  );
  // Sections 3 et 4 — paiements reçus, récapitulatif, taux de référence (R1)
  out = tagPaymentRows(out);
  out = fillAfter(out, "TOTAL GÉNÉRAL (USD)", "{total_general}", 1);
  out = fillAfter(out, "TOTAL DÉJÀ PAYÉ (USD)", "{total_paye}", 1);
  out = fillAfter(out, "TOTAL GÉNÉRAL (USD)", "{total_general}", 2);
  out = fillAfter(out, "TOTAL DÉJÀ PAYÉ (USD)", "{total_paye}", 2);
  out = fillAfter(out, "SOLDE À PAYER (USD) – montant qui fait foi", "{solde_usd}");
  out = fillAfter(out, "SOLDE À PAYER (FCFA) – indicatif", "{solde_fcfa}");
  out = replaceParagraph(
    out,
    "Taux de change – XE.com, taux moyen du marché",
    "Taux de change de référence – {taux_source}",
  );
  out = replaceParagraph(out, "1 USD = ____________ XOF", "1 USD = {taux} XOF");
  out = replaceParagraph(out, "relevé le ___ / ___ / ______ à ___h___ (UTC)", "relevé le {taux_releve} (UTC)");
  // Section 5 — échéancier (R4)
  out = editRow(out, "Paiement 1 – Section A (forfait acquisition)", (row) => {
    let r = setCellAfter(row, "Paiement 1 – Section A (forfait acquisition)", "{p1_montant}");
    r = replaceIn(r, (t) => t === "____ / ____ / ______", "{p1_echeance}");
    r = replaceIn(
      r,
      (t) => t.startsWith("au plus tard"),
      "au plus tard {p1_heures} h après la notification du lot remporté",
    );
    return replaceIn(r, (t) => t === "☐ Payé", "{p1_statut}");
  });
  out = editRow(out, "Solde – B + C (si acceptée) + D", (row) => {
    let r = setCellAfter(row, "Solde – B + C (si acceptée) + D", "{solde_montant}");
    r = replaceIn(r, (t) => t === "____ / ____ / ______", "{solde_echeance}");
    r = replaceIn(
      r,
      (t) => t.startsWith("48 h avant l’ETA"),
      "{solde_heures} h avant l’ETA du {solde_eta} indiquée en section 1 (règlement recommandé {solde_jours} jours avant)",
    );
    return replaceIn(r, (t) => t === "☐ Payé", "{solde_statut}");
  });
  // Section 6 — comptes officiels actifs (annexe D)
  out = fillAfter(out, "Virement bancaire", "{compte_banque}");
  out = fillAfter(out, "Wave", "{compte_wave}");
  out = fillAfter(out, "Orange Money", "{compte_orange_money}");
  out = fillAfter(out, "Référence à indiquer", "N° de dossier : {dossier_reference}");
  // Section 7 — conditions (valeurs des paramètres)
  out = replaceParagraph(
    out,
    "Devis valable 48 heures, en raison des délais de paiement imposés par les plateformes d’enchères.",
    "{conditions_validite}",
  );
  out = replaceParagraph(
    out,
    "Frais de retard : 100 USD par période de 14 jours commencée",
    "Frais de retard : {frais_retard} par période de {frais_retard_jours} jours commencée à compter du lendemain de l’échéance, sans préjudice des frais de tiers (stockage, port, stationnement).",
    { prefix: true },
  );
  out = replaceParagraph(
    out,
    "La propriété du véhicule est transférée au Client au paiement intégral",
    "La propriété du véhicule est transférée au Client au paiement intégral ; les documents (B/L, titre, factures) sont remis sous {remise_heures} heures ouvrées après ce paiement, au Client ou à son mandataire muni d’une procuration et d’une pièce d’identité.",
    { prefix: true },
  );
  // Section 8 — signataires (dates et signatures restent manuscrites)
  out = replaceParagraph(out, "Nom : ______________________________", "Nom : {usa_representant}");
  out = replaceParagraph(out, "Nom : ______________________________", "Nom : {client_nom}");
  const leftovers = paragraphsOf(out)
    .map(paragraphText)
    .filter(
      (t) => /_{4,}/.test(t) && !/^(Date : |Initiales du Client|_+$)/.test(t) && !t.includes("Initiales du Client"),
    );
  if (leftovers.length > 0) throw new Error(`Espaces réservés non balisés : ${leftovers.join(" | ")}`);
  return out;
}

// Logo en en-tête (décision D4) : 3,8 cm de large, proportions de public/logo-usa-cars.png (512 × 201).
const LOGO_WIDTH_EMU = 1_371_600;
const LOGO_HEIGHT_EMU = Math.round((LOGO_WIDTH_EMU * 201) / 512);
const LOGO_RUN =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  `<wp:extent cx="${LOGO_WIDTH_EMU}" cy="${LOGO_HEIGHT_EMU}"/><wp:docPr id="1001" name="Logo" descr="USA CARS"/>` +
  '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo-usa-cars.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rIdLogoUsaCars"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_WIDTH_EMU}" cy="${LOGO_HEIGHT_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
  "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";

/** En-tête du devis : le nom « USA CARS » laisse place au logo, suivi du type de document. */
function tagFinancialHeader(xml: string): string {
  const usa = xml.indexOf('<w:t xml:space="preserve">USA </w:t></w:r>');
  const carsEnd = xml.indexOf("<w:t>CARS</w:t></w:r>") + "<w:t>CARS</w:t></w:r>".length;
  if (usa < 0 || carsEnd < usa) throw new Error("Nom « USA CARS » introuvable dans l’en-tête du devis.");
  // Début de la balise de run (<w:r> ou <w:r …>), jamais <w:rPr> qui commence par les mêmes caractères.
  const start = Math.max(xml.lastIndexOf("<w:r>", usa), xml.lastIndexOf("<w:r ", usa));
  let out = `${xml.slice(0, start)}${LOGO_RUN}${xml.slice(carsEnd)}`;
  out = replaceText(out, " | DEVIS", " | {titre_entete}");
  out = out.replace('<w:t xml:space="preserve"> / FACTURE CLIENT</w:t>', '<w:t xml:space="preserve"></w:t>');
  return tagHeader(out);
}

/** Image du logo, sa relation depuis l'en-tête et son type de contenu. */
function addLogo(zip: PizZip) {
  zip.file("word/media/logo-usa-cars.png", readFileSync(resolve(LOGO)));
  zip.file(
    "word/_rels/header1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdLogoUsaCars" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo-usa-cars.png"/>' +
      "</Relationships>",
  );
  const types = zip.file("[Content_Types].xml")!.asText();
  if (!types.includes('Extension="png"')) {
    zip.file(
      "[Content_Types].xml",
      types.replace("<Default ", '<Default Extension="png" ContentType="image/png"/><Default '),
    );
  }
}

// ---------------------------------------------------------------------------
// Reçu espèces RC et note de remboursement RB (docs/16 : « à créer, 1 page, même charte ») : corps simple,
// en-tête (logo) et pied de page du modèle devis / facture.
// ---------------------------------------------------------------------------
function receiptParagraph(value: string, { bold = false, size = 20, center = false, after = 120 } = {}): string {
  return (
    `<w:p><w:pPr><w:spacing w:after="${after}"/>${center ? '<w:jc w:val="center"/>' : ""}</w:pPr>` +
    `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr>` +
    `<w:t xml:space="preserve">${value}</w:t></w:r></w:p>`
  );
}

function tagReceiptDocument(xml: string): string {
  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const sectionProperties = xml.lastIndexOf("<w:sectPr");
  const body = [
    receiptParagraph("{titre_document}", { bold: true, size: 28, center: true, after: 60 }),
    receiptParagraph(
      "USA CARS – {usa_forme_juridique} – RCCM : {usa_rccm} – NINEA : {usa_ninea} – {usa_bureau} – Tél. : {usa_telephone}",
      { size: 16, center: true, after: 240 },
    ),
    receiptParagraph("Date : {date_document}"),
    receiptParagraph("Référence dossier : {dossier_reference}    N° contrat : {contrat_reference}"),
    receiptParagraph("Client : {client_nom}    Téléphone : {client_telephone}", { after: 240 }),
    receiptParagraph("{objet}", { bold: true }),
    receiptParagraph("Montant : {montant_usd} (le montant en USD fait foi)"),
    receiptParagraph("Équivalent : {montant_fcfa}"),
    receiptParagraph("Mode : {mode}    Référence : {reference}", { after: 240 }),
    receiptParagraph("{mention}", { size: 18, after: 480 }),
    receiptParagraph("Pour USA CARS : {usa_representant}        Signature : __________________", { after: 360 }),
    receiptParagraph("{libelle_client} : {client_nom}        Signature : __________________"),
  ].join("");
  return `${xml.slice(0, bodyStart)}${body}${xml.slice(sectionProperties)}`;
}

// ---------------------------------------------------------------------------
// Courriers de la procédure « véhicule non réclamé » (US-5.3) : lettre de relance et mise en demeure, même charte
// que le reçu ; le corps est une liste de paragraphes répétée (boucle docxtemplater).
// ---------------------------------------------------------------------------
function tagLetterDocument(xml: string): string {
  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const sectionProperties = xml.lastIndexOf("<w:sectPr");
  const body = [
    receiptParagraph("{titre_document}", { bold: true, size: 28, center: true, after: 60 }),
    receiptParagraph(
      "USA CARS – {usa_forme_juridique} – RCCM : {usa_rccm} – NINEA : {usa_ninea} – {usa_bureau} – Tél. : {usa_telephone}",
      { size: 16, center: true, after: 360 },
    ),
    receiptParagraph("Dakar, le {date_document}", { after: 240 }),
    receiptParagraph("{client_nom}", { bold: true, after: 0 }),
    receiptParagraph("{client_adresse}", { after: 0 }),
    receiptParagraph("Tél. : {client_telephone}", { after: 240 }),
    receiptParagraph("{references}", { size: 18 }),
    receiptParagraph("Objet : {objet}", { bold: true, after: 240 }),
    receiptParagraph("Madame, Monsieur,"),
    // Boucle sur des paragraphes entiers : balises d'ouverture et de fermeture seules dans leur paragraphe.
    receiptParagraph("{#paragraphes}", { after: 0 }),
    receiptParagraph("{texte}", { after: 160 }),
    receiptParagraph("{/paragraphes}", { after: 0 }),
    receiptParagraph("Veuillez agréer, Madame, Monsieur, l’expression de nos salutations distinguées.", { after: 480 }),
    receiptParagraph("Pour USA CARS : {usa_representant}, {usa_qualite}"),
    receiptParagraph("Signature : __________________"),
  ].join("");
  return `${xml.slice(0, bodyStart)}${body}${xml.slice(sectionProperties)}`;
}

const contract = build("contrat-revise", OUTPUT_CONTRACT, tagDocument, tagHeader);
const purchaseOrder = build("ordre-achat-revise", OUTPUT_PURCHASE_ORDER, tagPurchaseOrder, tagPurchaseOrderHeader);
const financial = build("devis-facture-revise", OUTPUT_FINANCIAL, tagFinancialDocument, tagFinancialHeader, {
  source: FINANCIAL_SOURCE,
  extra: addLogo,
});
const receipt = build("recu", OUTPUT_RECEIPT, tagReceiptDocument, tagFinancialHeader, {
  source: FINANCIAL_SOURCE,
  extra: addLogo,
});
const letter = build("courrier", OUTPUT_LETTER, tagLetterDocument, tagFinancialHeader, {
  source: FINANCIAL_SOURCE,
  extra: addLogo,
});

mkdirSync(dirname(resolve(OUTPUT_MODULE)), { recursive: true });
writeFileSync(
  resolve(OUTPUT_MODULE),
  [
    "// GÉNÉRÉ par `pnpm templates:generate` (scripts/prepare-document-templates.ts) : ne pas modifier à la main.",
    "// Modèles balisés en base64, embarqués dans la fonction Supabase generate-document (pas d'accès au disque).",
    `export const CONTRACT_TEMPLATE_VERSION = "${contract.version}";`,
    `export const CONTRACT_TEMPLATE_BASE64 =\n  "${contract.bytes.toString("base64")}";`,
    `export const PURCHASE_ORDER_TEMPLATE_VERSION = "${purchaseOrder.version}";`,
    `export const PURCHASE_ORDER_TEMPLATE_BASE64 =\n  "${purchaseOrder.bytes.toString("base64")}";`,
    `export const FINANCIAL_TEMPLATE_VERSION = "${financial.version}";`,
    `export const FINANCIAL_TEMPLATE_BASE64 =\n  "${financial.bytes.toString("base64")}";`,
    `export const RECEIPT_TEMPLATE_VERSION = "${receipt.version}";`,
    `export const RECEIPT_TEMPLATE_BASE64 =\n  "${receipt.bytes.toString("base64")}";`,
    `export const LETTER_TEMPLATE_VERSION = "${letter.version}";`,
    `export const LETTER_TEMPLATE_BASE64 =\n  "${letter.bytes.toString("base64")}";`,
    "",
  ].join("\n"),
  "utf8",
);
