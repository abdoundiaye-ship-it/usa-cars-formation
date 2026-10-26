"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, success, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const visibilitySchema = z.object({
  documentId: z.uuid("Document inconnu."),
  visible: z.enum(["true", "false"]).transform((v) => v === "true"),
});

/** US-2.8 : rendre un document visible du client (portail) ou le garder interne — journalisé par la base. */
export async function setDocumentVisibility(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.documentsWrite))) {
    return failure("Action réservée à l’administrateur, aux agents opérations et à la comptabilité.");
  }
  const parsed = visibilitySchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Document inconnu.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ visible_client: parsed.data.visible })
    .eq("id", parsed.data.documentId)
    .select("dossier_id");
  if (error || !data?.length) return failure("La visibilité n’a pas pu être modifiée.");

  revalidatePath("/documents");
  if (data[0]?.dossier_id) revalidatePath(`/dossiers/${data[0].dossier_id}`);
  return success(parsed.data.visible ? "Document visible du client." : "Document réservé à l’équipe.");
}
