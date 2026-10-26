/**
 * Contrat de prestation d'un dossier (US-2.2, règle R14) : données du modèle templates/contrat_prestation.docx.
 * Module autonome (Deno et Vitest) — voir docx.ts.
 */
import { BLANK, formatDate, formatInteger, platformBoxes, renderTemplate, text, type AuctionPlatform } from "./docx.ts";
import { CONTRACT_TEMPLATE_BASE64, CONTRACT_TEMPLATE_VERSION } from "./document-templates.generated.ts";

export { BLANK, CONTRACT_TEMPLATE_VERSION, platformBoxes };
export type { AuctionPlatform };

/** Identité légale de USA CARS : paramètres company.* (valeur « À compléter » tant qu'ils ne sont pas saisis). */
export interface CompanyIdentity {
  legalForm: string;
  rccm: string;
  ninea: string;
  officeAddress: string;
  phone: string;
  email: string;
  representativeName: string;
  representativeTitle: string;
}

export const COMPANY_SETTING_KEYS: Record<keyof CompanyIdentity, string> = {
  legalForm: "company.legal_form",
  rccm: "company.rccm",
  ninea: "company.ninea",
  officeAddress: "company.office_address",
  phone: "company.phone",
  email: "company.email",
  representativeName: "company.representative_name",
  representativeTitle: "company.representative_title",
};

/** Libellés des pièces d'identité (mêmes valeurs que lib/dossiers/labels.ts, vérifié par un test). */
export const ID_DOCUMENT_LABELS: Record<string, string> = {
  national_id: "Carte d’identité",
  passport: "Passeport",
  residence_permit: "Titre de séjour",
  other: "Autre pièce",
};

export interface ContractClient {
  kind: "person" | "company";
  name: string;
  address: string | null;
  notify_phone: string;
  notify_email: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  ninea: string | null;
  rccm: string | null;
  representative_name: string | null;
  representative_title: string | null;
}

export interface ContractDossier {
  reference: string;
  platform: AuctionPlatform | null;
  lot_number: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  mileage: number | null;
  title_status: string | null;
  purchase_location: string | null;
  departure_port: string | null;
}

/** Article 33 : durées de conservation après la clôture (paramètres, décision G2-a), null tant qu'elles sont vides. */
export interface RetentionYears {
  accounting: number | null;
  other: number | null;
}

export const RETENTION_SETTING_KEYS: Record<keyof RetentionYears, string> = {
  accounting: "data.retention_years_accounting",
  other: "data.retention_years",
};

/** « 10 ans », « 1 an » ; espace réservé si la durée n'est pas fixée. */
export function retentionYearsText(years: number | null): string {
  if (years === null || !Number.isInteger(years) || years < 1) return "______ ans";
  return `${years} an${years > 1 ? "s" : ""}`;
}

export interface ContractInput {
  reference: string;
  date: Date;
  /** Paramètre templates.legal_validated : tant qu'il est faux, le document porte la mention « PROJET » (D1). */
  legalValidated: boolean;
  company: CompanyIdentity;
  retention: RetentionYears;
  client: ContractClient;
  dossier: ContractDossier;
}

/** Données du modèle (balises `{…}` de templates/contrat_prestation.docx). */
export function buildContractData(input: ContractInput): Record<string, string | boolean> {
  const { client, dossier, company } = input;
  const isCompany = client.kind === "company";
  const piece =
    client.id_document_type && client.id_document_number
      ? `${ID_DOCUMENT_LABELS[client.id_document_type] ?? "Pièce"} n° ${client.id_document_number}`
      : null;
  const nineaRccm = [client.ninea && `NINEA ${client.ninea}`, client.rccm && `RCCM ${client.rccm}`]
    .filter(Boolean)
    .join(" · ");
  const makeModel = [dossier.make, dossier.model].filter((v) => v && v.trim()).join(" ");

  return {
    projet: !input.legalValidated,
    contrat_reference: input.reference,
    dossier_reference: dossier.reference,
    date_contrat: formatDate(input.date),
    usa_forme_juridique: text(company.legalForm),
    usa_rccm: text(company.rccm),
    usa_ninea: text(company.ninea),
    usa_bureau: text(company.officeAddress),
    usa_telephone: text(company.phone),
    usa_email: text(company.email),
    usa_representant: text(company.representativeName),
    usa_representant_fonction: text(company.representativeTitle),
    client_nom: text(client.name),
    client_adresse: text(client.address),
    client_telephone: text(client.notify_phone),
    client_email: text(client.notify_email),
    client_piece: text(piece),
    client_ninea_rccm: isCompany ? text(nineaRccm) : "Sans objet",
    client_representant: isCompany ? text(client.representative_name) : "Sans objet",
    client_representant_fonction: isCompany ? text(client.representative_title) : "Sans objet",
    client_signataire: text(isCompany ? client.representative_name : client.name),
    client_signataire_fonction: isCompany ? text(client.representative_title ?? client.name) : "Client",
    plateforme_cases: platformBoxes(dossier.platform),
    lot: text(dossier.lot_number),
    vin: text(dossier.vin),
    prix_adjudication: BLANK, // connu après l'enchère
    marque_modele: text(makeModel),
    annee: text(dossier.model_year),
    kilometrage: dossier.mileage === null ? BLANK : `${formatInteger(dossier.mileage)} miles`,
    statut_titre: text(dossier.title_status),
    lieu_achat: text(dossier.purchase_location),
    port_prevu: text(dossier.departure_port),
    conservation_comptable: retentionYearsText(input.retention.accounting),
    conservation_autres: retentionYearsText(input.retention.other),
  };
}

export function renderContract(input: ContractInput): Uint8Array {
  return renderTemplate(CONTRACT_TEMPLATE_BASE64, buildContractData(input));
}
