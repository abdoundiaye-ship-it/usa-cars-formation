import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Valeurs numériques des paramètres en vigueur (CLAUDE.md règle 4 : aucun seuil en dur dans le code). */
export async function currentNumbers<K extends string>(keys: readonly K[]): Promise<Record<K, number | null>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("settings_current")
    .select("key, value")
    .in("key", [...keys]);
  const result = {} as Record<K, number | null>;
  for (const key of keys) {
    const value = data?.find((s) => s.key === key)?.value;
    result[key] = typeof value === "number" ? value : null;
  }
  return result;
}
