import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** R12 : nombre de jours sans vérification au-delà duquel un conteneur en mer est signalé (paramètre en vigueur). */
export async function maxDaysWithoutCheck(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("settings_current")
    .select("value")
    .eq("key", "tracking.max_days_without_check_in_transit")
    .maybeSingle();
  return typeof data?.value === "number" ? data.value : Number.POSITIVE_INFINITY;
}
