import { describe, expect, it } from "vitest";
import { newPasswordSchema, mfaCodeSchema, signInSchema } from "@/lib/validation/auth";
import { changeRoleSchema, inviteUserSchema, setActiveSchema } from "@/lib/validation/users";
import { parseEffectiveFrom, settingVersionSchema } from "@/lib/validation/settings";
import { safeNextPath } from "./redirect";
import { canAccess, isInternalRole, SCREEN_ROLES } from "./roles";

describe("safeNextPath (pas de redirection ouverte)", () => {
  it("accepte un chemin interne", () => {
    expect(safeNextPath("/parametres?x=1")).toBe("/parametres?x=1");
  });
  it("refuse les URL externes et les boucles de connexion", () => {
    expect(safeNextPath("https://exemple.test")).toBe("/tableau-de-bord");
    expect(safeNextPath("//exemple.test")).toBe("/tableau-de-bord");
    expect(safeNextPath("/\\exemple.test")).toBe("/tableau-de-bord");
    expect(safeNextPath("/connexion/mfa")).toBe("/tableau-de-bord");
    expect(safeNextPath(undefined)).toBe("/tableau-de-bord");
  });
});

describe("rôles et écrans (docs/12_roles_permissions.md)", () => {
  it("seuls admin et direction voient l’audit et les utilisateurs", () => {
    expect(canAccess("admin", SCREEN_ROLES.audit)).toBe(true);
    expect(canAccess("management", SCREEN_ROLES.audit)).toBe(true);
    expect(canAccess("ops", SCREEN_ROLES.audit)).toBe(false);
    expect(canAccess("accounting", SCREEN_ROLES.users)).toBe(false);
    expect(canAccess("client", SCREEN_ROLES.settings)).toBe(false);
  });
  it("seul l’administrateur modifie utilisateurs et paramètres", () => {
    expect(SCREEN_ROLES.usersWrite).toEqual(["admin"]);
    expect(SCREEN_ROLES.settingsWrite).toEqual(["admin"]);
  });
  it("le client n’est pas un rôle interne", () => {
    expect(isInternalRole("client")).toBe(false);
    expect(isInternalRole("ops")).toBe(true);
    expect(isInternalRole(null)).toBe(false);
  });
});

describe("validation des formulaires (Zod)", () => {
  it("connexion : e-mail normalisé", () => {
    const r = signInSchema.safeParse({ email: " Admin@Exemple.TEST ", password: "x" });
    expect(r.success && r.data.email).toBe("admin@exemple.test");
  });

  it("code MFA : 6 chiffres", () => {
    expect(mfaCodeSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(mfaCodeSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(mfaCodeSchema.safeParse({ code: "12a456" }).success).toBe(false);
  });

  it("mot de passe : 12 caractères, minuscule, majuscule, chiffre, confirmation identique", () => {
    expect(newPasswordSchema.safeParse({ password: "DemoUsaCars2026", confirmation: "DemoUsaCars2026" }).success).toBe(
      true,
    );
    expect(newPasswordSchema.safeParse({ password: "court1A", confirmation: "court1A" }).success).toBe(false);
    expect(
      newPasswordSchema.safeParse({ password: "sansmajuscule2026", confirmation: "sansmajuscule2026" }).success,
    ).toBe(false);
    const mismatch = newPasswordSchema.safeParse({ password: "DemoUsaCars2026", confirmation: "DemoUsaCars2027" });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) expect(mismatch.error.issues[0]?.path).toEqual(["confirmation"]);
  });

  it("invitation : rôle interne uniquement (pas de compte client en phase 1)", () => {
    const base = { fullName: "Agent Démo", email: "agent@exemple.test" };
    expect(inviteUserSchema.safeParse({ ...base, role: "ops" }).success).toBe(true);
    expect(inviteUserSchema.safeParse({ ...base, role: "client" }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ ...base, fullName: "A", role: "ops" }).success).toBe(false);
    const parsed = inviteUserSchema.safeParse({ ...base, role: "ops" });
    expect(parsed.success && parsed.data.delivery).toBe("lien"); // pas d’e-mail par défaut (pas de domaine)
    expect(inviteUserSchema.safeParse({ ...base, role: "ops", delivery: "sms" }).success).toBe(false);
  });

  it("changement de rôle et activation", () => {
    const userId = "d0000000-0000-4000-8000-000000000002";
    expect(changeRoleSchema.safeParse({ userId, role: "accounting" }).success).toBe(true);
    expect(changeRoleSchema.safeParse({ userId: "x", role: "accounting" }).success).toBe(false);
    const r = setActiveSchema.safeParse({ userId, active: "false" });
    expect(r.success && r.data.active).toBe(false);
  });

  it("nouvelle version de paramètre : motif obligatoire, date d’effet à l’heure de Dakar", () => {
    const base = { key: "quote.validity_hours", value: "24", status: "confirme" };
    expect(settingVersionSchema.safeParse({ ...base, reason: "Alignement" }).success).toBe(true);
    expect(settingVersionSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(settingVersionSchema.safeParse({ ...base, reason: "ok ok", effectiveFrom: "pas une date" }).success).toBe(
      false,
    );
    expect(parseEffectiveFrom("2026-11-01T08:30")?.toISOString()).toBe("2026-11-01T08:30:00.000Z");
    expect(parseEffectiveFrom("")).toBeNull();
  });
});
