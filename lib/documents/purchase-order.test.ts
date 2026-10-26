import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { xmlStructureError } from "@/lib/documents/well-formed-xml";
import { formatUsd } from "@/lib/format";
import { formatDateTimeDakar, formatUsdCents } from "@/supabase/functions/_shared/docx.ts";
import {
  buildPurchaseOrderData,
  renderPurchaseOrder,
  type PurchaseOrderInput,
} from "@/supabase/functions/_shared/purchase-order.ts";

const input: PurchaseOrderInput = {
  contractReference: "UC-2026-0042",
  legalValidated: false,
  dossier: {
    reference: "UC-2026-0042",
    platform: "copart",
    lot_number: "DEMO-LOT-42",
    vin: "1DEMXXX0000000042",
    make: "Toyota",
    model: "RAV4",
    model_year: 2020,
    purchase_location: "Houston, TX",
    title_status: null,
  },
  auctionAt: new Date("2026-10-21T15:30:00Z"),
  maxBidCents: 1_245_000,
  depositCents: 300_000,
};

function textOf(bytes: Uint8Array): string {
  const zip = new PizZip(bytes);
  // Un fichier dont une partie XML est mal formée ne s'ouvre pas dans Word.
  for (const part of Object.keys(zip.files).filter((f) => /\.(xml|rels)$/.test(f))) {
    expect(xmlStructureError(zip.file(part)!.asText()), part).toBeNull();
  }
  const xml = ["word/document.xml", "word/header1.xml"].map((f) => zip.file(f)!.asText()).join("");
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("");
}

describe("ordre d’achat — annexe B (US-2.3)", () => {
  it("met en forme les montants comme l’application (12 450 $US)", () => {
    for (const cents of [1_245_000, 1_245_050, 100]) expect(formatUsdCents(cents)).toBe(formatUsd(cents as never));
  });

  it("date et heure de l’enchère à l’heure de Dakar", () => {
    expect(formatDateTimeDakar(new Date("2026-10-21T15:30:00Z"))).toBe("21/10/2026 à 15h30 (heure de Dakar)");
  });

  it("prépare les données : enchère maximale, dépôt attendu, véhicule", () => {
    const data = buildPurchaseOrderData(input);
    expect(data.enchere_max).toBe("12 450 $US");
    expect(data.depot).toBe("3 000 $US (montant attendu)");
    expect(data.vehicule).toBe("Toyota RAV4 2020");
    expect(buildPurchaseOrderData({ ...input, depositCents: 0 }).depot).toBe("Aucun");
  });

  it("génère l’annexe B seule, rattachée au contrat, sans balise restante", () => {
    const text = textOf(renderPurchaseOrder(input));
    expect(text).toContain("ORDRE D’ACHAT — ANNEXE B DU CONTRAT UC-2026-0042");
    expect(text).toContain("ANNEXE B – ORDRE D’ACHAT ET MANDAT D’ENCHÈRE");
    expect(text).toContain("☒ COPART");
    expect(text).toContain("DEMO-LOT-42");
    expect(text).toContain("PROJET : document non validé juridiquement");
    expect(text).not.toContain("Article 1");
    expect(text).not.toContain("ANNEXE C");
    expect(text).not.toMatch(/[{}]/);
  });
});
