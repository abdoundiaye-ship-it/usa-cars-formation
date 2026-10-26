import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSettingsMigrationSql, SETTINGS_LOTS, settingsByLot, toInitialSetting, type SpecSetting } from "./initial";
import { SETTING_LABELS } from "./labels";

const spec = JSON.parse(readFileSync(resolve("specs/parametres_contractuels.json"), "utf8")) as {
  settings: SpecSetting[];
};

describe("chargement initial des paramètres (CLAUDE.md règle 4)", () => {
  it("chaque valeur du JSON respecte son type", () => {
    for (const s of spec.settings) expect(() => toInitialSetting(s), s.key).not.toThrow();
  });

  it("les montants sont convertis en centimes", () => {
    const lateFee = spec.settings.find((s) => s.key === "late_fee.amount_usd")!;
    expect(toInitialSetting(lateFee).value).toBe(10_000);
  });

  it("chaque migration générée est à jour avec specs/parametres_contractuels.json", () => {
    for (const [name, specs] of Object.entries(settingsByLot(spec.settings))) {
      const lot = SETTINGS_LOTS[name]!;
      const migration = readFileSync(resolve(lot.migrationPath), "utf8");
      expect(migration.replace(/\r\n/g, "\n"), name).toBe(buildSettingsMigrationSql(specs, lot));
    }
  });

  it("refuse un lot inconnu", () => {
    expect(() => settingsByLot([{ ...spec.settings[0]!, lot: "inconnu" }])).toThrow(/lot inconnu/);
  });

  it("refuse une clé en double", () => {
    const first = spec.settings[0]!;
    expect(() => buildSettingsMigrationSql([first, first])).toThrow(/double/);
  });

  it("échappe les apostrophes", () => {
    const sql = buildSettingsMigrationSql([
      { key: "test.cle", value: "l’avis d'expert", type: "string", status: "confirme", source: "Contrat d'essai" },
    ]);
    expect(sql).toContain("'\"l’avis d''expert\"'::jsonb");
    expect(sql).toContain("'Contrat d''essai'");
  });

  it("chaque paramètre a un libellé français", () => {
    for (const s of spec.settings) expect(SETTING_LABELS[s.key], s.key).toBeDefined();
  });
});
