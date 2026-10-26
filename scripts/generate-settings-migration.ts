/** Génère les migrations de chargement des paramètres, une par lot (pnpm settings:generate). */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSettingsMigrationSql, SETTINGS_LOTS, settingsByLot, type SpecSetting } from "../lib/settings/initial";

export const SPEC_PATH = "specs/parametres_contractuels.json";

const spec = JSON.parse(readFileSync(resolve(SPEC_PATH), "utf8")) as { settings: SpecSetting[] };
for (const [name, specs] of Object.entries(settingsByLot(spec.settings))) {
  const lot = SETTINGS_LOTS[name]!;
  writeFileSync(resolve(lot.migrationPath), buildSettingsMigrationSql(specs, lot), "utf8");
  console.log(`✅ ${specs.length} paramètres (lot ${name}) écrits dans ${lot.migrationPath}`);
}
