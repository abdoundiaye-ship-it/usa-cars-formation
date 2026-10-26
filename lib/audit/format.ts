import { ROLE_LABELS, type AppRole } from "@/lib/auth/roles";
import type { Json } from "@/lib/supabase/database.types";

export const ACTION_LABELS: Record<string, string> = {
  insert: "Création",
  update: "Modification",
  delete: "Suppression",
  resend_invite: "Invitation renvoyée",
  access_link: "Lien d’accès généré",
  mfa_enroll: "Double authentification activée",
  bootstrap_admin: "Création du compte administrateur initial",
};

export const OBJECT_LABELS: Record<string, string> = {
  profiles: "Utilisateur",
  settings: "Paramètre",
};

export const FIELD_LABELS: Record<string, string> = {
  role: "Rôle",
  active: "Actif",
  full_name: "Nom",
  email: "E-mail",
  client_id: "Client",
  value: "Valeur",
  value_type: "Type",
  status: "Statut",
  source: "Source",
  reason: "Motif",
  effective_from: "Date d’effet",
};

/** Champs techniques non affichés dans le détail. */
const HIDDEN_FIELDS = new Set(["id", "created_at", "updated_at", "created_by", "key"]);

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function objectLabel(objectType: string): string {
  return OBJECT_LABELS[objectType] ?? objectType;
}

function displayValue(field: string, value: Json | undefined): string {
  if (value === undefined || value === null) return "—";
  if (field === "role" && typeof value === "string" && value in ROLE_LABELS) return ROLE_LABELS[value as AppRole];
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (field === "status" && value === "a_confirmer") return "À confirmer";
  if (field === "status" && value === "confirme") return "Confirmé";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export interface FieldChange {
  field: string;
  label: string;
  before?: string;
  after?: string;
}

function asRecord(value: Json | null): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Liste lisible des champs concernés par une entrée d’audit (avant → après). */
export function describeChanges(before: Json | null, after: Json | null): FieldChange[] {
  const b = asRecord(before);
  const a = asRecord(after);
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((f) => !HIDDEN_FIELDS.has(f));
  return fields.map((field) => ({
    field,
    label: FIELD_LABELS[field] ?? field,
    before: field in b ? displayValue(field, b[field]) : undefined,
    after: field in a ? displayValue(field, a[field]) : undefined,
  }));
}
