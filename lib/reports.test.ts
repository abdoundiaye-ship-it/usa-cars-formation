import { describe, expect, it } from "vitest";
import { average, averagesBy, reportFilters, reportsFor, total } from "./reports";

describe("écran Rapports (US-6.1)", () => {
  it("rapports par rôle (docs/12) : la marge pour l’administrateur et la direction seulement", () => {
    expect(reportsFor("admin")).toEqual([
      "active_dossiers",
      "delays",
      "receivables",
      "transit_times",
      "margins",
      "retention",
      "access_review",
    ]);
    expect(reportsFor("management")).toContain("margins");
    expect(reportsFor("management")).toContain("retention");
    expect(reportsFor("ops")).toEqual(["active_dossiers", "delays", "transit_times"]);
    expect(reportsFor("accounting")).toEqual(["delays", "receivables"]);
    expect(reportsFor("client")).toEqual([]);
  });

  it("filtres : période de l’année par défaut, dates invalides ignorées, dates inversées remises dans l’ordre", () => {
    expect(reportFilters({}, "2026-10-21")).toEqual({ from: "2026-01-01", to: "2026-10-21", asOf: "2026-10-21" });
    expect(reportFilters({ du: "2026-09-30", au: "2026-07-01", situation: "21/10/2026" }, "2026-10-21")).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      asOf: "2026-10-21",
    });
  });

  it("moyennes et totaux en ignorant les valeurs absentes", () => {
    const rows = [
      { carrier_name: "Maersk", days_at_sea: 30, margin_cents: 245_000 },
      { carrier_name: "MSC", days_at_sea: 41, margin_cents: null },
      { carrier_name: "Maersk", days_at_sea: 33, margin_cents: 100_000 },
      { carrier_name: "Maersk", days_at_sea: null, margin_cents: 5 },
    ];
    expect(average(rows, "days_at_sea")).toBe(34.7);
    expect(average([], "days_at_sea")).toBeNull();
    expect(total(rows, "margin_cents")).toBe(345_005);
    expect(averagesBy(rows, "carrier_name", ["days_at_sea"])).toEqual([
      { group: "Maersk", count: 3, averages: { days_at_sea: 31.5 } },
      { group: "MSC", count: 1, averages: { days_at_sea: 41 } },
    ]);
  });
});
