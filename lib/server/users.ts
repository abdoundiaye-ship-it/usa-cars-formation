import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AuthUserSummary {
  lastSignInAt: string | null;
  invitedAt: string | null;
}

/** Informations de connexion (table auth.users) — réservé aux écrans administrateur. */
export async function listAuthUsersSummary(): Promise<Map<string, AuthUserSummary>> {
  const admin = createSupabaseAdminClient();
  const result = new Map<string, AuthUserSummary>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
    if (error) break;
    for (const user of data.users) {
      result.set(user.id, { lastSignInAt: user.last_sign_in_at ?? null, invitedAt: user.invited_at ?? null });
    }
    if (data.users.length < 500) break;
  }
  return result;
}
