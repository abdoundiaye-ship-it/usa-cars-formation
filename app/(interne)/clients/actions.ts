"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clientSchema, type ClientInput } from "@/lib/validation/operations";

const WRITERS_ONLY = "Action réservée à l’administrateur et aux agents opérations.";

function toRow(input: ClientInput) {
  const isCompany = input.kind === "company";
  return {
    kind: input.kind,
    name: input.name,
    id_document_type: input.idDocumentType,
    id_document_number: input.idDocumentNumber,
    ninea: isCompany ? input.ninea : null,
    rccm: isCompany ? input.rccm : null,
    representative_name: isCompany ? input.representativeName : null,
    representative_title: isCompany ? input.representativeTitle : null,
    address: input.address,
    notify_phone: input.notifyPhone,
    notify_email: input.notifyEmail,
    notes: input.notes,
  };
}

/** US-2.1 : création d'une fiche client (personne ou société). */
export async function createClient(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);

  const parsed = clientSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("clients").insert(toRow(parsed.data)).select("id").single();
  if (error || !data) {
    return withValues(failure("La fiche client n’a pas pu être créée. Vérifiez les champs et réessayez."), formData);
  }

  revalidatePath("/clients");
  redirect(`/clients/${data.id}?cree=1` as Route);
}

/** US-2.1 : modification d'une fiche client (journalisée par la base). */
export async function updateClient(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);

  const id = z.uuid().safeParse(formData.get("clientId"));
  if (!id.success) return failure("Client inconnu.");
  const parsed = clientSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("clients").update(toRow(parsed.data)).eq("id", id.data).select("id");
  if (error) return withValues(failure("Les modifications n’ont pas pu être enregistrées. Réessayez."), formData);
  if (!data?.length) return failure(WRITERS_ONLY);

  revalidatePath(`/clients/${id.data}`);
  revalidatePath("/clients");
  return success("Fiche client enregistrée.");
}
