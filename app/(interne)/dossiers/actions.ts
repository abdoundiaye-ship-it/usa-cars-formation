"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { UPLOADABLE_DOCUMENT_KINDS } from "@/lib/dossiers/labels";
import { generateContract, generateDocument } from "@/lib/server/contracts";
import { storeDossierFile } from "@/lib/server/documents";
import type { DocumentKind } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  acceptanceSchema,
  advanceStageSchema,
  ageOverrideSchema,
  auctionResultSchema,
  cancelDossierSchema,
  confirmationSchema,
  dossierIdSchema,
  newDossierSchema,
  proofFileError,
  purchaseOrderSchema,
  statusSchema,
  vehicleSchema,
  type VehicleInput,
} from "@/lib/validation/operations";
import { assignContainerSchema } from "@/lib/validation/shipping";

const WRITERS_ONLY = "Action réservée à l’administrateur et aux agents opérations.";

/** Message d'une règle métier de la base (22023) ou d'un refus explicite (42501), sinon message générique. */
const ruleMessage = (error: { code?: string; message: string } | null, fallback: string) =>
  error && (error.code === "22023" || error.code === "42501") ? error.message : fallback;

function vehicleRow(input: VehicleInput) {
  return {
    platform: input.platform,
    lot_number: input.lotNumber,
    vin: input.vin,
    make: input.make,
    model: input.model,
    model_year: input.modelYear,
    mileage: input.mileage,
    vehicle_category: input.vehicleCategory,
    title_status: input.titleStatus,
    color: input.color,
    purchase_location: input.purchaseLocation,
    departure_port: input.departurePort,
    notes: input.notes,
  };
}

const dossierPath = (id: string) => `/dossiers/${id}` as Route;

/**
 * Ouverture d'un dossier (un véhicule) et génération immédiate de son contrat (R14).
 * Si la génération échoue, le dossier reste ouvert : le contrat peut être généré depuis sa fiche.
 */
export async function createDossier(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);

  const parsed = newDossierSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dossiers")
    .insert({ client_id: parsed.data.clientId, ...vehicleRow(parsed.data) })
    .select("id")
    .single();
  if (error || !data) {
    const message =
      error?.code === "23503"
        ? "Client inconnu : choisissez un client dans la liste."
        : "Le dossier n’a pas pu être ouvert.";
    return withValues(failure(message), formData);
  }

  const contract = await generateContract(data.id);
  revalidatePath("/dossiers");
  redirect(`${dossierPath(data.id)}?${contract.ok ? "ouvert=1" : "contrat=erreur"}` as Route);
}

/** Modification des informations du véhicule (le client et la référence restent figés). */
export async function updateVehicle(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);

  const id = dossierIdSchema.safeParse(formObject(formData));
  if (!id.success) return failure("Dossier inconnu.");
  const parsed = vehicleSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dossiers")
    .update(vehicleRow(parsed.data))
    .eq("id", id.data.dossierId)
    .select("id");
  if (error) {
    return withValues(
      failure(ruleMessage(error, "Les informations du véhicule n’ont pas pu être enregistrées.")),
      formData,
    );
  }
  if (!data?.length) return failure(WRITERS_ONLY);

  revalidatePath(dossierPath(id.data.dossierId));
  return success(
    "Véhicule enregistré. Si le contrat ou l’ordre d’achat n’est pas encore signé, régénérez-le pour y reporter ces informations.",
  );
}

/** Génère ou régénère le contrat tant qu'aucune décision n'est enregistrée. */
export async function regenerateContract(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const id = dossierIdSchema.safeParse(formObject(formData));
  if (!id.success) return failure("Dossier inconnu.");

  const result = await generateContract(id.data.dossierId);
  if (!result.ok) return failure(result.message);
  revalidatePath(dossierPath(id.data.dossierId));
  return success("Contrat généré. Téléchargez la nouvelle version pour la faire signer.");
}

const SUBJECT_LABELS = {
  contract: "du contrat",
  purchase_order: "de l’ordre d’achat",
  quote: "du devis",
  extra_cost: "des frais supplémentaires",
} as const;

/**
 * R15 : décision du client sur le contrat (US-2.2), l'ordre d'achat (US-2.3) ou le devis (US-3.3, avec le choix
 * d'assurance — X1), par scan ou WhatsApp. La preuve est téléversée dans le bucket privé ; la base impose la
 * version en vigueur et son empreinte, les 4 confirmations de l'annexe B et la validité du devis.
 */
export async function recordAcceptance(_previous: FormState, formData: FormData): Promise<FormState> {
  // Devis : admin, agent, comptabilité ; frais supplémentaires : admin, comptabilité ; sinon admin et agent.
  const requested = formData.get("subject");
  const allowed =
    requested === "quote"
      ? SCREEN_ROLES.quotesWrite
      : requested === "extra_cost"
        ? SCREEN_ROLES.invoicesWrite
        : SCREEN_ROLES.operationsWrite;
  if (!(await getInternalAccess(allowed))) {
    return failure(
      requested === "quote"
        ? "Action réservée à l’administrateur, aux agents opérations et à la comptabilité."
        : requested === "extra_cost"
          ? "Action réservée à l’administrateur et à la comptabilité."
          : WRITERS_ONLY,
    );
  }

  const parsed = acceptanceSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const proof = formData.get("proof");
  const proofError = proofFileError(proof instanceof File ? proof : null);
  if (proofError) {
    return withValues(
      { status: "error", message: "La preuve est à joindre.", fieldErrors: { proof: proofError } },
      formData,
    );
  }
  const {
    dossierId,
    subject,
    subjectId,
    method,
    decision,
    decidedAt,
    insuranceChoice,
    whatsappFrom,
    notes,
    acknowledgements,
  } = parsed.data;

  const proofId = await storeDossierFile(dossierId, "acceptance_proof", proof as File);
  if (!proofId) return withValues(failure("La preuve n’a pas pu être enregistrée. Réessayez."), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("acceptances").insert({
    dossier_id: dossierId,
    subject,
    subject_id: subjectId,
    document_id: proofId, // remplacé par la base (version en vigueur du document)
    document_sha256: "0".repeat(64), // idem
    method,
    decision,
    decided_at: (decidedAt.getTime() > Date.now() ? new Date() : decidedAt).toISOString(),
    proof_document_id: proofId,
    whatsapp_from: whatsappFrom,
    acknowledgements,
    insurance_choice: insuranceChoice,
    notes,
  });
  if (error) {
    return withValues(failure(ruleMessage(error, "La décision du client n’a pas pu être enregistrée.")), formData);
  }

  revalidatePath(dossierPath(dossierId));
  return success(
    decision === "accepted"
      ? `Acceptation ${SUBJECT_LABELS[subject]} enregistrée.`
      : `Refus ${SUBJECT_LABELS[subject]} enregistré.`,
  );
}

/**
 * US-2.3 : saisie de l'ordre d'achat puis génération du document à faire signer.
 * Si la génération est refusée (véhicule incomplet ou trop âgé), l'ordre reste enregistré et le motif est affiché.
 */
export async function savePurchaseOrder(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = purchaseOrderSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { dossierId, maxBid, deposit, auctionAt } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const terms = { max_bid_cents: maxBid, deposit_cents: deposit, auction_at: auctionAt };
  const { data: existing } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("dossier_id", dossierId)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("purchase_orders").update(terms).eq("id", existing.id)
    : await supabase.from("purchase_orders").insert({ dossier_id: dossierId, ...terms });
  if (error) return withValues(failure(ruleMessage(error, "L’ordre d’achat n’a pas pu être enregistré.")), formData);

  const generated = await generateDocument(dossierId, "purchase_order");
  revalidatePath(dossierPath(dossierId));
  if (!generated.ok) return failure(`Ordre d’achat enregistré, mais document non généré : ${generated.message}`);
  return success("Ordre d’achat généré. Téléchargez-le pour le faire signer avec les 4 confirmations.");
}

/** Dérogation au contrôle de l'âge du véhicule : administrateur seulement, avec motif (US-2.3). */
export async function overrideImportAge(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(["admin"]))) {
    return failure("Dérogation réservée à l’administrateur (avec double authentification validée).");
  }
  const parsed = ageOverrideSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ age_override_reason: parsed.data.reason })
    .eq("dossier_id", parsed.data.dossierId)
    .select("id");
  if (error || !data?.length) {
    return withValues(
      failure(ruleMessage(error, "Saisissez d’abord l’ordre d’achat, puis enregistrez la dérogation.")),
      formData,
    );
  }
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Dérogation enregistrée et journalisée. Vous pouvez générer l’ordre d’achat.");
}

/** US-2.4 : résultat de l'enchère (gagné avec prix et notification, ou perdu : dossier clôturé). */
export async function recordAuctionResult(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = auctionResultSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const value = parsed.data;
  const { error } = await supabase.rpc(
    "record_auction_result",
    value.result === "lost"
      ? { p_dossier_id: value.dossierId, p_result: "lost" }
      : {
          p_dossier_id: value.dossierId,
          p_result: "won",
          p_hammer_price_cents: value.hammerPriceCents,
          p_notified_at: value.notifiedAt,
          ...(value.overrideReason ? { p_override_reason: value.overrideReason } : {}),
        },
  );
  if (error) {
    return withValues(failure(ruleMessage(error, "Le résultat de l’enchère n’a pas pu être enregistré.")), formData);
  }
  revalidatePath(dossierPath(value.dossierId));
  return success(value.result === "won" ? "Lot remporté enregistré." : "Lot non remporté : dossier clôturé.");
}

/** Hypothèse P1 : confirmation manuelle d'un élément financier, en attendant la phase 3. */
export async function confirmManually(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(["admin", "ops", "accounting"]))) {
    return failure("Action réservée à l’administrateur, aux agents opérations et à la comptabilité.");
  }
  const parsed = confirmationSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("dossier_confirmations")
    .insert({ dossier_id: parsed.data.dossierId, code: parsed.data.code, note: parsed.data.note });
  if (error) {
    return failure(error.code === "23505" ? "Déjà confirmé." : "La confirmation n’a pas pu être enregistrée.");
  }
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Confirmation enregistrée et journalisée.");
}

/** US-2.5 : passage à l'étape suivante ; exception de l'administrateur avec motif (R13). */
export async function advanceStage(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = advanceStageSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("advance_stage", {
    p_dossier_id: parsed.data.dossierId,
    ...(parsed.data.reason ? { p_override_reason: parsed.data.reason } : {}),
  });
  if (error) return withValues(failure(ruleMessage(error, "Le passage d’étape a échoué.")), formData);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Étape suivante enregistrée.");
}

/** US-2.5 : changement de statut à l'intérieur de l'étape en cours. */
export async function changeStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = statusSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dossiers")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.dossierId)
    .select("id");
  if (error || !data?.length) {
    return failure(
      error?.code === "23503" ? "Ce statut n’existe pas dans l’étape en cours." : "Le statut n’a pas pu être changé.",
    );
  }
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Statut enregistré.");
}

/** Annulation d'un dossier (Ouverture ou Achat → Clôture), motif obligatoire. */
export async function cancelDossier(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = cancelDossierSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_dossier", {
    p_dossier_id: parsed.data.dossierId,
    p_reason: parsed.data.reason,
  });
  if (error) return withValues(failure(ruleMessage(error, "L’annulation a échoué.")), formData);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Dossier annulé.");
}

/** Documents demandés par les conditions de passage (facture d'enchère, preuve de prise en charge…). */

export async function uploadDossierDocument(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.documentsWrite))) {
    return failure("Action réservée à l’administrateur, aux agents opérations et à la comptabilité.");
  }
  const id = dossierIdSchema.safeParse(formObject(formData));
  if (!id.success) return failure("Dossier inconnu.");
  const kind = formData.get("kind");
  if (typeof kind !== "string" || !(UPLOADABLE_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    return { status: "error", message: "Choisissez le type de document.", fieldErrors: { kind: "Type obligatoire." } };
  }
  const file = formData.get("file");
  if (proofFileError(file instanceof File ? file : null)) {
    return {
      status: "error",
      message: "Le fichier est à joindre.",
      fieldErrors: { file: "Joignez un fichier PDF, JPEG, PNG, WebP ou HEIC de 20 Mo au plus." },
    };
  }
  const documentId = await storeDossierFile(
    id.data.dossierId,
    kind as DocumentKind,
    file as File,
    formData.get("visibleClient") === "on",
  );
  if (!documentId) return failure("Le document n’a pas pu être enregistré. Réessayez.");
  revalidatePath(dossierPath(id.data.dossierId));
  return success("Document ajouté au dossier.");
}

/** « Dupliquer le dossier » (R14) : nouveau dossier pour le même client, avec son propre contrat. */
export async function duplicateDossier(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const id = dossierIdSchema.safeParse(formObject(formData));
  if (!id.success) return failure("Dossier inconnu.");

  const supabase = await createSupabaseServerClient();
  const { data: newId, error } = await supabase.rpc("duplicate_dossier", { p_dossier_id: id.data.dossierId });
  if (error || !newId) return failure("Le dossier n’a pas pu être dupliqué.");

  const contract = await generateContract(newId);
  revalidatePath("/dossiers");
  redirect(`${dossierPath(newId)}?${contract.ok ? "duplique=1" : "contrat=erreur"}` as Route);
}

/** US-2.6 / B4 : associer le véhicule à un conteneur, ou le changer de conteneur (motif, historique). */
export async function assignContainer(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = assignContainerSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("assign_container", {
    p_dossier_id: parsed.data.dossierId,
    p_container_id: parsed.data.containerId,
    ...(parsed.data.reason ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) return withValues(failure(ruleMessage(error, "Le conteneur n’a pas pu être associé.")), formData);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Conteneur associé au véhicule.");
}
