import { parseUsdToCents } from "@/lib/money/cents";
import { isValidSettingValue, parseSettingType, type SettingValue } from "./types";

/**
 * Chargement initial de la table settings depuis specs/parametres_contractuels.json (CLAUDE.md règle 4).
 * Le résultat est une migration SQL versionnée (appliquée aussi en production), pas un seed.
 */

export interface SpecSetting {
  key: string;
  value: unknown;
  type: string;
  status: "confirme" | "a_confirmer";
  source?: string;
  /** Lot de chargement (absent : chargement initial de la phase 1). Voir SETTINGS_LOTS. */
  lot?: string;
}

export interface InitialSetting {
  key: string;
  value: SettingValue;
  valueType: string;
  status: "confirme" | "a_confirmer";
  source: string | null;
}

/** Date d’effet du chargement initial : fixe, pour que la migration soit déterministe et rejouable. */
export const INITIAL_EFFECTIVE_FROM = "2026-10-17T00:00:00Z";

/** Lot de paramètres : une migration par lot, jamais réécrite une fois appliquée en production. */
export interface SettingsLot {
  migrationPath: string;
  effectiveFrom: string;
  header: string[];
}

export const INITIAL_LOT = "initial";

/** Paramètres ajoutés après la phase 1 : nouveau lot (champ `lot` du JSON), nouvelle migration additive. */
export const SETTINGS_LOTS: Record<string, SettingsLot> = {
  [INITIAL_LOT]: {
    migrationPath: "supabase/migrations/20261017100300_parametres_initiaux.sql",
    effectiveFrom: INITIAL_EFFECTIVE_FROM,
    header: [
      "-- Phase 1 — chargement initial des paramètres contractuels.",
      "-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json : ne pas modifier à la main.",
      "-- Montants (type money) en centimes USD. Les modifications ultérieures passent par l’écran Paramètres",
      "-- (nouvelle version datée), jamais par la modification de cette migration une fois appliquée en production.",
    ],
  },
  phase2: {
    migrationPath: "supabase/migrations/20261019100000_parametres_phase2.sql",
    effectiveFrom: "2026-10-19T00:00:00Z",
    header: [
      "-- Phase 2 — paramètres ajoutés (identité légale de USA CARS pour le contrat).",
      "-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase2 ») :",
      "-- ne pas modifier à la main. Valeurs saisies ensuite par l’administrateur dans l’écran Paramètres.",
    ],
  },
  phase2d: {
    migrationPath: "supabase/migrations/20261019100500_parametres_tableau_de_bord.sql",
    effectiveFrom: "2026-10-19T00:00:00Z",
    header: [
      "-- Phase 2, lot 2d — seuils de la liste « À traiter » du tableau de bord.",
      "-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase2d ») :",
      "-- ne pas modifier à la main. Valeurs modifiables ensuite dans l’écran Paramètres.",
    ],
  },
  phase4a: {
    migrationPath: "supabase/migrations/20261020100400_parametres_portail.sql",
    effectiveFrom: "2026-10-20T00:00:00Z",
    header: [
      "-- Phase 4, lot 4a — connexion des clients au portail (lien à usage unique, R16).",
      "-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase4a ») :",
      "-- ne pas modifier à la main. Valeurs modifiables ensuite dans l’écran Paramètres.",
    ],
  },
  phase5: {
    migrationPath: "supabase/migrations/20261020100800_parametres_recouvrement.sql",
    effectiveFrom: "2026-10-20T00:00:00Z",
    header: [
      "-- Phase 5, lot 5b — numérotation des courriers de la procédure « véhicule non réclamé » (art. 21–22).",
      "-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase5 ») :",
      "-- ne pas modifier à la main. Valeurs modifiables ensuite dans l’écran Paramètres.",
    ],
  },
  phase6: {
    migrationPath: "supabase/migrations/20261021100100_parametres_donnees_personnelles.sql",
    effectiveFrom: "2026-10-21T00:00:00Z",
    header: [
      "-- Phase 6, lot 6b — données personnelles : conservation des pièces comptables (G2-a), page Confidentialité (G1-a).",
      "-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase6 ») :",
      "-- ne pas modifier à la main. Valeurs modifiables ensuite dans l’écran Paramètres.",
    ],
  },
};

/** Paramètres du JSON regroupés par lot. */
export function settingsByLot(specs: SpecSetting[]): Record<string, SpecSetting[]> {
  const result: Record<string, SpecSetting[]> = {};
  for (const spec of specs) {
    const lot = spec.lot ?? INITIAL_LOT;
    if (!SETTINGS_LOTS[lot]) throw new Error(`Paramètre ${spec.key} : lot inconnu « ${lot} ».`);
    (result[lot] ??= []).push(spec);
  }
  return result;
}

/** Normalise une entrée du JSON : `money` y est exprimé en dollars, stocké en centimes. */
export function toInitialSetting(spec: SpecSetting): InitialSetting {
  parseSettingType(spec.type);
  let value = spec.value as SettingValue;
  if (spec.type === "money" && value !== null) {
    const cents = typeof value === "number" ? parseUsdToCents(String(value)) : null;
    if (cents === null) throw new Error(`Paramètre ${spec.key} : montant invalide (${String(spec.value)}).`);
    value = cents;
  }
  if (!isValidSettingValue(spec.type, value)) {
    throw new Error(
      `Paramètre ${spec.key} : valeur ${JSON.stringify(spec.value)} incompatible avec le type ${spec.type}.`,
    );
  }
  return { key: spec.key, value, valueType: spec.type, status: spec.status, source: spec.source ?? null };
}

const sqlString = (text: string) => `'${text.replace(/'/g, "''")}'`;

export function buildSettingsMigrationSql(
  specs: SpecSetting[],
  lot: SettingsLot = SETTINGS_LOTS[INITIAL_LOT]!,
): string {
  const keys = new Set<string>();
  const rows = specs.map((spec) => {
    if (keys.has(spec.key)) throw new Error(`Paramètre en double : ${spec.key}.`);
    keys.add(spec.key);
    const s = toInitialSetting(spec);
    return `  (${[
      sqlString(s.key),
      `${sqlString(JSON.stringify(s.value))}::jsonb`,
      sqlString(s.valueType),
      sqlString(s.status),
      s.source === null ? "null" : sqlString(s.source),
      `${sqlString(lot.effectiveFrom)}::timestamptz`,
    ].join(", ")})`;
  });

  return [
    ...lot.header,
    "",
    "insert into public.settings (key, value, value_type, status, source, effective_from) values",
    `${rows.join(",\n")}`,
    "on conflict (key, effective_from) do nothing;",
    "",
  ].join("\n");
}
