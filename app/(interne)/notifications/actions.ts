"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, success, type FormState } from "@/lib/forms";
import { dispatchNotifications } from "@/lib/server/notifications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PATH = "/notifications";
const WRITERS = "Action réservée à l’administrateur, aux agents opérations et à la comptabilité.";

/** Renvoi d'une notification en échec (journalisé), puis envoi immédiat. */
export async function retryNotification(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.notificationsWrite))) return failure(WRITERS);
  const parsed = z.object({ id: z.uuid() }).safeParse(formObject(formData));
  if (!parsed.success) return failure("Notification inconnue.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("retry_notification", { p_id: parsed.data.id });
  if (error) return failure(error.code === "22023" ? error.message : "Le renvoi n’a pas pu être demandé.");
  await dispatchNotifications();
  revalidatePath(PATH);
  return success("Notification renvoyée.");
}

/** Envoi immédiat des messages en attente (sans attendre l'envoi programmé de chaque minute). */
export async function dispatchNow(): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.notificationsWrite))) return failure(WRITERS);
  const result = await dispatchNotifications();
  revalidatePath(PATH);
  return result.ok ? success("Envoi déclenché.") : failure("Le service d’envoi ne répond pas. Réessayez.");
}

/** Message de test (administrateur), adressé aux destinataires de test configurés au déploiement. */
export async function sendTestNotification(): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.notificationsTest))) return failure("Action réservée à l’administrateur.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("queue_test_notification");
  if (error) return failure("Le message de test n’a pas pu être préparé.");
  await dispatchNotifications();
  revalidatePath(PATH);
  return success("Message de test envoyé par e-mail et WhatsApp (voir le journal ci-dessous).");
}
