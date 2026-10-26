import { z } from "zod";

/** Adresse e-mail : espaces retirés et minuscules AVANT la validation (saisie mobile, copier-coller). */
export function emailField(message = "Saisissez une adresse e-mail valide.") {
  return z.string(message).trim().toLowerCase().pipe(z.email(message));
}
