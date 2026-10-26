import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { xmlStructureError } from "@/lib/documents/well-formed-xml";
import { COST_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatUsd } from "@/lib/format";
import { usdCentsToXof as appUsdCentsToXof } from "@/lib/money/fx";
import {
  buildFinancialDocumentData,
  formatRate,
  renderFinancialDocument,
  usdCentsToXof,
  type FinancialDocumentInput,
} from "@/supabase/functions/_shared/financial-document.ts";
import { buildReceiptData, renderReceipt, type ReceiptInput } from "@/supabase/functions/_shared/receipt.ts";

const quote: FinancialDocumentInput = {
  docType: "quote",
  number: "DV-2026-0007",
  issuedAt: new Date("2026-10-19T10:00:00Z"),
  validUntil: new Date("2026-10-20T08:00:00Z"),
  payment1DueAt: new Date("2026-10-20T08:00:00Z"),
  legalValidated: false,
  contractReference: "UC-2026-0042",
  company: {
    legalForm: "SARL",
    rccm: "SN-DKR-DEMO",
    ninea: "DEMO-NINEA",
    officeAddress: "Dakar, adresse fictive",
    phone: "+221330000000",
    email: "contact@exemple.test",
    representativeName: "Gérant Démo",
    representativeTitle: "Gérant",
  },
  client: {
    kind: "person",
    name: "Mamadou Diallo (démo)",
    notify_phone: "+221770000001",
    notify_email: "client@exemple.test",
    id_document_type: "passport",
    id_document_number: "DEMO-PASS-1",
    ninea: null,
    rccm: null,
  },
  dossier: {
    reference: "UC-2026-0042",
    platform: "copart",
    lot_number: "DEMO-LOT-42",
    vin: "1DEMXXX0000000042",
    make: "Toyota",
    model: "RAV4",
    model_year: 2020,
    purchase_location: "Houston, TX",
    departure_port: null,
  },
  amounts: {
    forfaitACents: 1_150_000,
    forfaitBCents: 320_000,
    insurancePremiumCents: 25_000,
    insuranceChoice: "pending",
    vatRatePercent: "0.00",
    vatCents: 0,
    insuranceVatCents: 0,
    totalCents: 1_470_000,
    depositAppliedCents: 0,
    depositExcessCents: 0,
    amountDueCents: 1_470_000,
  },
  referenceRate: {
    rate: "587.1000",
    source: "XE.com — taux moyen du marché",
    capturedAt: new Date("2026-10-19T09:30:00Z"),
  },
  editionRate: { rate: "587.1000", capturedAt: new Date("2026-10-19T09:30:00Z") },
  payments: [
    {
      creditedAt: new Date("2026-10-15T12:00:00Z"),
      mode: "bank_transfer",
      reference: "VIR-DEMO-1",
      amountCents: 300_000,
      paidCurrency: "USD",
      amountXof: null,
      fxRate: "586.5200",
    },
  ],
  accounts: [
    {
      kind: "bank",
      holder_name: "USA CARS (démo)",
      bank_name: "Banque Démo",
      account_number: "DEMO-0000-0001",
      iban: "SN00 DEMO 0000 0000 0000 0001",
      phone: null,
    },
    {
      kind: "wave",
      holder_name: "USA CARS (démo)",
      bank_name: null,
      account_number: null,
      iban: null,
      phone: "+221770000900",
    },
  ],
  terms: {
    validityHours: 48,
    payment1DueHoursAfterWin: 24,
    balanceDueHoursBeforeEta: 48,
    balanceRecommendedDaysBeforeEta: 7,
    lateFeeCents: 10_000,
    lateFeePeriodDays: 14,
    releaseBusinessHours: 48,
  },
};

const invoice: FinancialDocumentInput = {
  ...quote,
  docType: "deposit_invoice",
  number: "FA-2026-0003",
  validUntil: null,
  amounts: {
    ...quote.amounts,
    forfaitBCents: null,
    insuranceChoice: "accepted",
    totalCents: 1_150_000,
    depositAppliedCents: 300_000,
    amountDueCents: 850_000,
  },
  editionRate: { rate: "590.2500", capturedAt: new Date("2026-10-20T07:00:00Z") },
};

/** Texte brut du document Word généré (corps + en-tête). */
function textOf(bytes: Uint8Array): string {
  const zip = new PizZip(bytes);
  // Un fichier dont une partie XML est mal formée ne s'ouvre pas dans Word.
  for (const part of Object.keys(zip.files).filter((f) => /\.(xml|rels)$/.test(f))) {
    expect(xmlStructureError(zip.file(part)!.asText()), part).toBeNull();
  }
  const xml = ["word/document.xml", "word/header1.xml"].map((f) => zip.file(f)!.asText()).join("");
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
}

describe("devis et facture d'acompte — fonction generate-document (US-3.3, US-3.4)", () => {
  it("conversion FCFA identique à lib/money/fx (R1)", () => {
    for (const [cents, rate] of [
      [1_470_000, "587.1000"],
      [1, "586.5200"],
      [12_345_67, "600.0001"],
      [850_000, "590.2500"],
    ] as const) {
      expect(usdCentsToXof(cents, rate)).toBe(appUsdCentsToXof(cents, rate));
    }
    expect(formatRate("587.1000")).toBe("587,10");
    expect(formatRate("600.0125")).toBe("600,0125");
  });

  it("devis : lignes A, B, option C, total hors et avec assurance, validité alignée sur le paiement 1 (X2)", () => {
    const data = buildFinancialDocumentData(quote);
    expect(data.titre_document).toBe("DEVIS N° DV-2026-0007");
    expect(data.case_devis).toBe("☒");
    expect(data.case_fa).toBe("☐");
    expect(data.montant_a).toBe(formatUsd(1_150_000));
    expect(data.montant_b).toBe(formatUsd(320_000));
    expect(data.montant_c).toBe(`${formatUsd(25_000)} (option)`);
    expect(data.total_general).toBe(`${formatUsd(1_470_000)} hors option C\n${formatUsd(1_495_000)} avec l’assurance`);
    expect(data.total_paye).toBe(formatUsd(300_000));
    // 14 700 − 3 000 = 11 700 $US × 587,10 = 6 869 070 FCFA
    expect(String(data.solde_fcfa).replace(/\s/g, " ")).toBe(
      "6 869 070 FCFA au taux du 19/10/2026 (indicatif, réactualisé au paiement)",
    );
    expect(data.conditions_validite).toContain("Devis valable 48 heures au plus, soit jusqu’au 20/10/2026 à 08h00");
    expect(data.frais_retard).toBe(formatUsd(10_000));
    expect(data.client_piece).toBe("Passeport n° DEMO-PASS-1");
  });

  it("facture d'acompte : totalité du forfait A, dépôt déduit, taux de référence du devis, FCFA au taux du jour", () => {
    const data = buildFinancialDocumentData(invoice);
    expect(data.titre_document).toBe("FACTURE D’ACOMPTE N° FA-2026-0003");
    expect(data.case_fa).toBe("☒");
    expect(data.montant_b).toBe("Facturé au solde");
    expect(data.case_c_acceptee).toBe("☒");
    expect(data.solde_usd).toBe(formatUsd(850_000));
    expect(data.p1_montant).toBe(formatUsd(850_000));
    expect(data.taux).toBe("587,10");
    // 8 500 $US × 590,25 = 5 017 125 FCFA
    expect(String(data.solde_fcfa).replace(/\s/g, " ")).toBe(
      "5 017 125 FCFA au taux du 20/10/2026 (indicatif, réactualisé au paiement)",
    );
  });

  it("excédent de dépôt signalé (à restituer, R6)", () => {
    const data = buildFinancialDocumentData({
      ...invoice,
      amounts: { ...invoice.amounts, depositAppliedCents: 1_150_000, depositExcessCents: 50_000, amountDueCents: 0 },
    });
    expect(data.solde_usd).toBe(`${formatUsd(0)}\nExcédent de dépôt à restituer : ${formatUsd(50_000)}`);
    expect(data.p1_statut).toBe("☒ Payé");
  });

  it("fichier généré : logo en en-tête, mention PROJET, aucune balise restante", () => {
    const bytes = renderFinancialDocument(quote);
    const zip = new PizZip(bytes);
    expect(zip.file("word/media/logo-usa-cars.png")).not.toBeNull();
    expect(zip.file("word/_rels/header1.xml.rels")!.asText()).toContain("media/logo-usa-cars.png");
    const text = textOf(bytes);
    expect(text).toContain("DV-2026-0007");
    expect(text).toContain("PROJET");
    expect(text).toContain("SN00 DEMO 0000 0000 0000 0001");
    expect(text).not.toMatch(/[{}]|undefined|null|NaN/);
  });

  it("CLAUDE.md règle 2 : aucun libellé ni montant de coût interne dans le fichier généré", () => {
    // Coûts internes du dossier (montants choisis distincts de tout montant visible) : ils ne doivent jamais apparaître.
    const internalCosts = [
      { category: "hammer_price", amount_cents: 943_700 },
      { category: "auction_fees", amount_cents: 87_300 },
      { category: "ocean_freight", amount_cents: 178_100 },
    ] as const;
    for (const document of [quote, invoice, balanceFixture()]) {
      const text = textOf(renderFinancialDocument(document));
      for (const cost of internalCosts) {
        expect(text).not.toContain(COST_CATEGORY_LABELS[cost.category]);
        expect(text).not.toContain(formatUsd(cost.amount_cents));
      }
      expect(text.toLowerCase()).not.toMatch(/marge|coût interne|cout interne/);
    }
  });
});

function balanceFixture(): FinancialDocumentInput {
  return balance;
}

const balance: FinancialDocumentInput = {
  ...quote,
  docType: "balance_invoice",
  number: "FS-2026-0002",
  validUntil: null,
  payment1Paid: true,
  balanceDueAt: new Date("2026-11-18T00:00:00Z"),
  referenceEta: new Date("2026-11-20T00:00:00Z"),
  shipping: {
    carrier: "Transporteur Démo (fictif)",
    container: "DEMU1234560",
    vessel: "Navire Démo",
    voyage: "DEMO-001",
    bl: "DEMO-BL-0001",
    eta: new Date("2026-11-20T00:00:00Z"),
    trackingUrl: "https://exemple.test/suivi/DEMU1234560",
  },
  adjustments: [
    { label: "Stockage portuaire (urgence)", amountCents: 50_000 },
    { label: "Frais de retard — paiement 1, période 1", amountCents: 10_000 },
  ],
  amounts: {
    ...quote.amounts,
    insuranceChoice: "accepted",
    totalCents: 405_000,
    depositAppliedCents: 0,
    amountDueCents: 405_000,
  },
  payments: [],
};

describe("facture de solde (US-3.7, R4)", () => {
  it("B + C acceptée + lignes D, ETA de référence indicative, expédition renseignée", () => {
    const data = buildFinancialDocumentData(balance);
    expect(data.titre_document).toBe("FACTURE DE SOLDE N° FS-2026-0002");
    expect(data.case_fs).toBe("☒");
    expect(data.montant_a).toBe("Facturé à l’acompte");
    expect(data.montant_b).toBe(formatUsd(320_000));
    expect(data.montant_c).toBe(formatUsd(25_000));
    expect(data.montant_d).toBe(
      `Stockage portuaire (urgence) : ${formatUsd(50_000)}\nFrais de retard — paiement 1, période 1 : ${formatUsd(10_000)}\nTotal : ${formatUsd(60_000)}`,
    );
    expect(data.conteneur).toBe("DEMU1234560");
    expect(data.eta).toBe("20/11/2026 (indicative)");
    expect(data.solde_eta).toBe("20/11/2026 (indicative)");
    expect(data.solde_montant).toBe(formatUsd(405_000));
    expect(data.p1_statut).toBe("☒ Payé");
    const text = textOf(renderFinancialDocument(balance));
    expect(text).toContain("FS-2026-0002");
    expect(text).not.toMatch(/[{}]|undefined|null|NaN/);
  });
});

describe("reçu espèces RC et note de remboursement RB (C7)", () => {
  const base: ReceiptInput = {
    kind: "cash_receipt",
    number: "RC-2026-0001",
    issuedAt: new Date("2026-10-20T10:00:00Z"),
    legalValidated: false,
    contractReference: "UC-2026-0042",
    company: quote.company,
    client: { name: "Mamadou Diallo (démo)", notify_phone: "+221770000001" },
    dossierReference: "UC-2026-0042",
    amountCents: 600_000,
    amountXof: 3_600_000,
    rate: { rate: "600.0000", capturedAt: new Date("2026-10-20T09:00:00Z") },
    mode: "cash",
    reference: "ESP-0001",
    paidAt: new Date("2026-10-20T10:00:00Z"),
  };

  it("reçu : montant USD qui fait foi, FCFA reçus, aucune balise restante", () => {
    const data = buildReceiptData(base);
    expect(data.titre_document).toBe("REÇU DE PAIEMENT EN ESPÈCES N° RC-2026-0001");
    expect(String(data.montant_fcfa).replace(/\s/g, " ")).toBe(
      "3 600 000 FCFA reçus (taux du jour : 1 $US = 600,00 FCFA)",
    );
    const text = textOf(renderReceipt(base));
    expect(text).toContain("RC-2026-0001");
    expect(text).not.toMatch(/[{}]|undefined|null|NaN/);
  });

  it("note de remboursement : motif et restitution (jamais d'avoir, règle 12)", () => {
    const data = buildReceiptData({
      ...base,
      kind: "refund_note",
      number: "RB-2026-0001",
      amountCents: 115_000,
      amountXof: null,
      mode: "bank_transfer",
      refundReason: "overpayment",
    });
    expect(data.titre_document).toBe("NOTE DE REMBOURSEMENT N° RB-2026-0001");
    expect(data.objet).toContain("trop-perçu");
    expect(String(data.montant_fcfa).replace(/\s/g, " ")).toContain("690 000 FCFA au taux du 20/10/2026");
    expect(data.mention).toContain("jamais conservé comme avoir");
  });
});
