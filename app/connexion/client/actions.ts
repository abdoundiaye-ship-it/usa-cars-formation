"use server";

import { redirect } from "next/navigation";
import { failure, formObject, invalid, success, type FormState } from "@/lib/forms";
import { createClientLoginLink, findClientAccount, redeemClientLoginLink } from "@/lib/server/client-access";
import { deliverClientLoginLink } from "@/lib/server/notifications";
import { clientLinkRequestSchema } from "@/lib/validation/auth";

/** Réponse identique que le compte existe ou non : aucune divulgation des adresses ou numéros enregistrés. */
const SENT =
  "Si un espace client correspond à cette adresse ou à ce numéro, un lien de connexion vient d’être envoyé par e-mail et par WhatsApp. Il est valable quelques minutes.";

/** US-4.1 : le client demande un lien de connexion (e-mail ou numéro WhatsApp). */
export async function requestClientLink(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = clientLinkRequestSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const account = await findClientAccount(parsed.data);
  if (!account) return success(SENT);
  const channel = "email" in parsed.data ? "email" : "whatsapp";
  const link = await createClientLoginLink(account.userId, account.clientId, channel);
  if (!link.ok) return failure(link.message);
  await deliverClientLoginLink(account.clientId, link.url);
  return success(SENT);
}

/** Ouverture du lien (bouton « Accéder à mon espace ») : session ouverte, puis l'espace client. */
export async function redeemClientLink(_previous: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  if (!(await redeemClientLoginLink(token))) {
    return failure("Ce lien n’est plus valide (déjà utilisé ou expiré). Demandez un nouveau lien ci-dessous.");
  }
  redirect("/espace");
}
