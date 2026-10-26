import { z } from "zod";
import { emailField } from "./common";
import { normalizePhone } from "./operations";

export const PASSWORD_MIN_LENGTH = 12;

export const signInSchema = z.object({
  email: emailField(),
  password: z.string().min(1, "Saisissez votre mot de passe."),
  suite: z.string().optional(),
});

export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Le code comporte 6 chiffres, affichés dans votre application d’authentification."),
  factorId: z.string().optional(),
  suite: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailField(),
});

export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit comporter au moins ${PASSWORD_MIN_LENGTH} caractères.`)
      .regex(/[a-z]/, "Ajoutez au moins une lettre minuscule.")
      .regex(/[A-Z]/, "Ajoutez au moins une lettre majuscule.")
      .regex(/\d/, "Ajoutez au moins un chiffre."),
    confirmation: z.string(),
  })
  .refine((v) => v.password === v.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne sont pas identiques.",
  });

/** US-4.1 : demande d'un lien de connexion client — adresse e-mail ou numéro WhatsApp (format international). */
export const clientLinkRequestSchema = z
  .object({ identifier: z.string().trim().min(3, "Saisissez votre adresse e-mail ou votre numéro WhatsApp.") })
  .transform((value, ctx) => {
    if (value.identifier.includes("@")) {
      const email = z.email().safeParse(value.identifier.toLowerCase());
      if (email.success) return { email: email.data } as const;
    } else {
      const phone = normalizePhone(value.identifier);
      if (phone) return { phone } as const;
    }
    ctx.addIssue({
      code: "custom",
      path: ["identifier"],
      message: "Adresse e-mail ou numéro WhatsApp invalide (ex. +221 77 123 45 67).",
    });
    return z.NEVER;
  });
