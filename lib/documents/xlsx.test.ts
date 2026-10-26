import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { xmlStructureError } from "@/lib/documents/well-formed-xml";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { STAGE_LABELS } from "@/lib/dossiers/labels";
import {
  exportType,
  exportValue,
  REPORT_KEYS,
  REPORT_ROLE_LABELS,
  REPORT_STAGE_LABELS,
  REPORTS,
  reportArgs,
} from "@/supabase/functions/_shared/reports.ts";
import { buildXlsx, columnLetter, excelDate } from "@/supabase/functions/_shared/xlsx.ts";

describe("fichier Excel (P6-1)", () => {
  const bytes = buildXlsx({
    sheetName: "Créances / clients",
    title: "USA CARS — Créances par client",
    subtitle: "Situation au 21/10/2026",
    columns: [
      { label: "Client", type: "text" },
      { label: "Reste dû", type: "usd" },
      { label: "Depuis le", type: "date" },
      { label: "Jours", type: "int" },
      { label: "Marge %", type: "percent" },
    ],
    rows: [
      ["Diallo & fils <démo>", 300_000, "2026-10-21", 45, 18.8],
      ["Client sans montant", null, null, null, null],
    ],
  });
  const zip = new PizZip(bytes);

  it("toutes les parties XML sont bien formées (le fichier s’ouvre dans Excel)", () => {
    const parts = Object.keys(zip.files).filter((f) => /\.(xml|rels)$/.test(f));
    expect(parts).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml"]),
    );
    for (const part of parts) expect(xmlStructureError(zip.file(part)!.asText()), part).toBeNull();
  });

  it("montants en dollars, dates en numéros de série, texte échappé, filtre sur l’en-tête", () => {
    const sheet = zip.file("xl/worksheets/sheet1.xml")!.asText();
    expect(sheet).toContain("Diallo &amp; fils &lt;démo&gt;");
    expect(sheet).toContain('<c r="B5" s="2"><v>3000</v></c>');
    expect(sheet).toContain(`<c r="C5" s="3"><v>${excelDate("2026-10-21")}</v></c>`);
    expect(sheet).toContain('<c r="E5" s="6"><v>18.8</v></c>');
    expect(sheet).not.toContain('r="B6"'); // cellule vide : absente
    expect(sheet).toContain('<autoFilter ref="A4:E6"/>');
    expect(zip.file("xl/workbook.xml")!.asText()).toContain('name="Créances   clients"');
  });

  it("lettres de colonnes et dates Excel", () => {
    expect([0, 25, 26, 27, 701].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "ZZ"]);
    expect(excelDate("2024-01-01")).toBe(45292);
    expect(excelDate("2026-10-21T14:00:00Z")).toBe(46316);
    expect(excelDate("21/10/2026")).toBeNull();
  });
});

describe("définition des rapports (US-6.1)", () => {
  it("libellés des étapes identiques à ceux de l’application", () => {
    expect(REPORT_STAGE_LABELS).toEqual(STAGE_LABELS);
    expect(REPORT_ROLE_LABELS).toEqual(ROLE_LABELS);
  });

  it("marge réservée à l’administrateur et à la direction ; aucun rapport pour le client", () => {
    expect(REPORTS.margins.roles).toEqual(["admin", "management"]);
    expect(REPORTS.retention.roles).toEqual(["admin", "management"]);
    for (const key of REPORT_KEYS) expect(REPORTS[key].roles).not.toContain("client");
  });

  it("paramètres de période et valeurs exportées", () => {
    expect(reportArgs("margins", { from: "2026-01-01", to: "2026-10-21" })).toEqual({
      p_from: "2026-01-01",
      p_to: "2026-10-21",
    });
    expect(reportArgs("receivables", { asOf: "2026-10-21" })).toEqual({ p_as_of: "2026-10-21" });
    expect(reportArgs("delays", {})).toEqual({});
    const [, , stage] = REPORTS.active_dossiers.columns;
    expect(exportValue(stage!, { stage: "dakar" })).toBe("Dakar");
    const final = REPORTS.margins.columns.find((c) => c.key === "costs_final")!;
    expect(exportValue(final, { costs_final: false })).toBe("non");
    const scope = REPORTS.retention.columns.find((c) => c.key === "scope")!;
    expect(exportValue(scope, { scope: "other_data" })).toBe("Hors pièces comptables");
    expect(exportType(scope)).toBe("text");
    const opened = REPORTS.active_dossiers.columns.find((c) => c.key === "opened_at")!;
    expect(exportValue(opened, { opened_at: "2026-10-21T08:00:00+00:00" })).toBe("2026-10-21");
  });
});
