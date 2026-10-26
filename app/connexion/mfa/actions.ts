"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { failure, formObject, invalid, success, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mfaCodeSchema } from "@/lib/validation/auth";

/** Démarre l’enrôlement TOTP : QR code + clé à saisir dans l’application d’authentification. */
export async function startEnrollment(): Promise<FormState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failure("Votre session a expiré. Reconnectez-vous.");

  // Nettoie les enrôlements commencés mais jamais validés.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "USA CARS",
    friendlyName: `USA CARS ${new Date().toISOString()}`,
  });
  if (error || !data) return failure("La configuration n’a pas pu démarrer. Réessayez dans un instant.");

  return success("Scannez le QR code, puis saisissez le code à 6 chiffres affiché.", {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  });
}

/** Vérifie un code TOTP (enrôlement ou connexion) et élève la session au niveau aal2. */
export async function verifyMfaCode(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formObject(formData);
  const parsed = mfaCodeSchema.safeParse(fields);
  if (!parsed.success) return invalid(parsed.error, "Le code n’est pas valide.");
  if (!parsed.data.factorId) return failure("Configuration introuvable. Rechargez la page.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) {
    return failure("Code incorrect ou expiré. Saisissez le code affiché actuellement dans l’application.");
  }

  if (fields.mode === "enroll") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      // Ne bloque pas la connexion si la journalisation est refusée (ex. compte client).
      await supabase.rpc("log_audit", { p_action: "mfa_enroll", p_object_type: "profiles", p_object_id: user.id });
    }
  }

  redirect(safeNextPath(parsed.data.suite) as Route);
}
