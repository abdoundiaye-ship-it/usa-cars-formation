import { z } from "zod";
import { emailField } from "./common";
import { INTERNAL_ROLES } from "@/lib/auth/roles";

const roleSchema = z.enum(INTERNAL_ROLES, "Choisissez un rôle dans la liste.");
const userIdSchema = z.uuid("Utilisateur inconnu.");

export const inviteUserSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Saisissez le nom complet (2 caractères minimum).")
    .max(120, "Le nom ne doit pas dépasser 120 caractères."),
  email: emailField(),
  role: roleSchema,
  /** « lien » : lien d’accès à copier (WhatsApp…), sans e-mail ; « email » : invitation envoyée par Supabase. */
  delivery: z.enum(["lien", "email"], "Choisissez le mode d’envoi.").default("lien"),
});

export const changeRoleSchema = z.object({
  userId: userIdSchema,
  role: roleSchema,
});

export const setActiveSchema = z.object({
  userId: userIdSchema,
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export const resendInviteSchema = z.object({ userId: userIdSchema });

export const accessLinkSchema = z.object({ userId: userIdSchema });
