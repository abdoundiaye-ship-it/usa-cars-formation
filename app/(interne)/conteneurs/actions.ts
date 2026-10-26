"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  containerDateSchema,
  containerIdSchema,
  containerSchema,
  etaSchema,
  trackingEventSchema,
  type ContainerInput,
} from "@/lib/validation/shipping";

const WRITERS_ONLY = "Action réservée à l’administrateur et aux agents opérations.";
const containerPath = (id: string) => `/conteneurs/${id}` as Route;

/** Message d'une règle métier de la base (22023) ou d'un refus explicite (42501), sinon message générique. */
const ruleMessage = (error: { code?: string; message: string } | null, fallback: string) =>
  error && (error.code === "22023" || error.code === "42501") ? error.message : fallback;

function detailsRow(input: ContainerInput) {
  return {
    carrier_id: input.carrierId,
    bl_number: input.blNumber,
    vessel: input.vessel,
    voyage: input.voyage,
    port_of_loading: input.portOfLoading,
    port_of_discharge: input.portOfDischarge,
    etd: input.etd,
    notes: input.notes,
  };
}

/** US-2.6 : création d'un conteneur (l'ETA initiale est historisée par la base, source « agent »). */
export async function createContainer(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = containerSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("containers")
    .insert({ number: parsed.data.number, eta: parsed.data.eta, ...detailsRow(parsed.data) })
    .select("id")
    .single();
  if (error || !data) {
    return withValues(
      failure(error?.code === "23505" ? "Ce conteneur existe déjà." : "Le conteneur n’a pas pu être créé."),
      formData,
    );
  }
  revalidatePath("/conteneurs");
  redirect(`${containerPath(data.id)}?cree=1` as Route);
}

/** Modification des références du conteneur (transporteur, B/L, navire, voyage, ports, départ prévu). */
export async function updateContainer(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = containerSchema.safeParse(formObject(formData));
  if (!parsed.success || !parsed.data.containerId) {
    return withValues(parsed.success ? failure("Conteneur inconnu.") : invalid(parsed.error), formData);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("containers")
    .update(detailsRow(parsed.data))
    .eq("id", parsed.data.containerId)
    .select("id");
  if (error || !data?.length) {
    return withValues(failure(ruleMessage(error, "Les modifications n’ont pas pu être enregistrées.")), formData);
  }
  revalidatePath(containerPath(parsed.data.containerId));
  return success("Conteneur enregistré.");
}

/** US-2.7 : nouvelle ETA indicative, avec sa source (historique conservé). */
export async function updateEta(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = etaSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_container_eta", {
    p_container_id: parsed.data.containerId,
    p_eta: parsed.data.eta,
    p_source: parsed.data.source,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) return withValues(failure(ruleMessage(error, "L’ETA n’a pas pu être enregistrée.")), formData);
  revalidatePath(containerPath(parsed.data.containerId));
  return success("ETA indicative enregistrée ; les dossiers concernés en sont informés.");
}

/** US-2.7 : départ réel du navire. */
export async function recordDeparture(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = containerDateSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_container_departure", {
    p_container_id: parsed.data.containerId,
    p_departed_on: parsed.data.date,
  });
  if (error) return withValues(failure(ruleMessage(error, "Le départ n’a pas pu être enregistré.")), formData);
  revalidatePath(containerPath(parsed.data.containerId));
  return success("Départ enregistré.");
}

/** US-2.7 : arrivée réelle (ATA). */
export async function recordArrival(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = containerDateSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_container_arrival", {
    p_container_id: parsed.data.containerId,
    p_ata: parsed.data.date,
  });
  if (error) return withValues(failure(ruleMessage(error, "L’ATA n’a pas pu être enregistrée.")), formData);
  revalidatePath(containerPath(parsed.data.containerId));
  return success("Arrivée enregistrée (ATA).");
}

/** R12 : « Vérifié aujourd'hui » sur le suivi du transporteur. */
export async function markChecked(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = containerIdSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Conteneur inconnu.");
  const { containerId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_container_checked", { p_container_id: containerId });
  if (error) return failure(ruleMessage(error, "La vérification n’a pas pu être enregistrée."));
  revalidatePath(containerPath(containerId));
  revalidatePath("/conteneurs");
  return success("Vérification enregistrée.");
}

/** US-2.7 : événement de suivi (transbordement, retard, information). */
export async function addTrackingEvent(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITERS_ONLY);
  const parsed = trackingEventSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("tracking_events").insert({
    container_id: parsed.data.containerId,
    kind: parsed.data.kind,
    source: parsed.data.source,
    occurred_at: new Date(`${parsed.data.occurredOn}T12:00:00Z`).toISOString(),
    label: parsed.data.label,
    location: parsed.data.location,
    visible_client: parsed.data.visibleClient,
  });
  if (error) return withValues(failure("L’événement n’a pas pu être enregistré."), formData);
  revalidatePath(containerPath(parsed.data.containerId));
  return success("Événement ajouté.");
}
