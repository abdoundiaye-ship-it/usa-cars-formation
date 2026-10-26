import { describe, expect, it } from "vitest";
import { closeProcedureSchema, issueLetterSchema, letterSentSchema, openProcedureSchema } from "./recovery";

const dossierId = "11111111-1111-4111-8111-111111111111";
const letterId = "22222222-2222-4222-8222-222222222222";

describe("procédure « véhicule non réclamé » (US-5.3)", () => {
  it("relance sans délai ; mise en demeure avec un délai en jours entiers", () => {
    expect(issueLetterSchema.parse({ dossierId, kind: "reminder", cureDays: "20" })).toEqual({
      dossierId,
      kind: "reminder",
      cureDays: null,
    });
    expect(issueLetterSchema.parse({ dossierId, kind: "formal_notice", cureDays: "15" }).cureDays).toBe(15);
    expect(issueLetterSchema.safeParse({ dossierId, kind: "formal_notice", cureDays: "" }).success).toBe(false);
    expect(issueLetterSchema.safeParse({ dossierId, kind: "formal_notice", cureDays: "7,5" }).success).toBe(false);
    expect(issueLetterSchema.safeParse({ dossierId, kind: "sale", cureDays: "" }).success).toBe(false);
  });

  it("envoi : date, canal connu ; précision facultative", () => {
    const sent = { dossierId, letterId, sentOn: "2026-10-20", channel: "courier", note: "" };
    expect(letterSentSchema.parse(sent).note).toBeNull();
    expect(letterSentSchema.safeParse({ ...sent, channel: "sms" }).success).toBe(false);
    expect(letterSentSchema.safeParse({ ...sent, sentOn: "" }).success).toBe(false);
  });

  it("procédure : motif obligatoire ; clôture avec issue et statut final connu", () => {
    expect(openProcedureSchema.safeParse({ dossierId, reason: "ok" }).success).toBe(false);
    expect(
      closeProcedureSchema.parse({ dossierId, outcome: "Solde réglé, véhicule enlevé", closingStatus: "completed" })
        .closingStatus,
    ).toBe("completed");
    expect(
      closeProcedureSchema.safeParse({ dossierId, outcome: "Vente du véhicule", closingStatus: "sold" }).success,
    ).toBe(false);
  });
});
