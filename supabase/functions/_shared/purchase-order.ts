/**
 * Ordre d'achat et mandat d'enchère (US-2.3, annexe B du contrat) : données du modèle templates/ordre_achat.docx.
 * Module autonome (Deno et Vitest) — voir docx.ts.
 */
import {
  formatDateTimeDakar,
  formatUsdCents,
  platformBoxes,
  renderTemplate,
  text,
  type AuctionPlatform,
} from "./docx.ts";
import { PURCHASE_ORDER_TEMPLATE_BASE64, PURCHASE_ORDER_TEMPLATE_VERSION } from "./document-templates.generated.ts";

export { PURCHASE_ORDER_TEMPLATE_VERSION };

export interface PurchaseOrderInput {
  contractReference: string;
  legalValidated: boolean;
  dossier: {
    reference: string;
    platform: AuctionPlatform | null;
    lot_number: string | null;
    vin: string | null;
    make: string | null;
    model: string | null;
    model_year: number | null;
    purchase_location: string | null;
    title_status: string | null;
  };
  auctionAt: Date | null;
  maxBidCents: number;
  /** Dépôt attendu (forfait A estimé, I2) ; son encaissement est enregistré en phase 3 (P2). */
  depositCents: number;
}

/** Données du modèle (balises `{…}` de templates/ordre_achat.docx). */
export function buildPurchaseOrderData(input: PurchaseOrderInput): Record<string, string | boolean> {
  const { dossier } = input;
  const vehicle = [dossier.make, dossier.model, dossier.model_year]
    .filter((v) => v !== null && String(v).trim())
    .join(" ");
  return {
    projet: !input.legalValidated,
    contrat_reference: input.contractReference,
    dossier_reference: dossier.reference,
    enchere_date: input.auctionAt ? formatDateTimeDakar(input.auctionAt) : text(null),
    plateforme_cases: platformBoxes(dossier.platform),
    lot: text(dossier.lot_number),
    vin: text(dossier.vin),
    vehicule: text(vehicle),
    lieu_vente: text(dossier.purchase_location),
    statut_titre: text(dossier.title_status),
    enchere_max: formatUsdCents(input.maxBidCents),
    depot: input.depositCents > 0 ? `${formatUsdCents(input.depositCents)} (montant attendu)` : "Aucun",
  };
}

export function renderPurchaseOrder(input: PurchaseOrderInput): Uint8Array {
  return renderTemplate(PURCHASE_ORDER_TEMPLATE_BASE64, buildPurchaseOrderData(input));
}
