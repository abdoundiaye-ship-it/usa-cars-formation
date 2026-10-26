import { describe, expect, it } from "vitest";
import {
  acceptanceSchema,
  auctionResultSchema,
  purchaseOrderSchema,
  clientSchema,
  missingClientInformation,
  normalizePhone,
  proofFileError,
  vehicleSchema,
} from "./operations";

describe("téléphone de notification (US-2.1 : format international +221…)", () => {
  it.each([
    ["+221 77 123 45 67", "+221771234567"],
    ["00221 77-123-45-67", "+221771234567"],
    ["77 123 45 67", "+221771234567"],
    ["+33 6 12 34 56 78", "+33612345678"],
  ])("%s → %s", (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(["", "12345", "0771234567", "+0 77 123", "abc"])("refuse « %s »", (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );
});

describe("fiche client", () => {
  const base = { kind: "person", name: "Awa Diop", notifyPhone: "77 123 45 67" };

  it("normalise et accepte une fiche minimale", () => {
    const parsed = clientSchema.parse({ ...base, notifyEmail: " Awa@Exemple.TEST " });
    expect(parsed.notifyPhone).toBe("+221771234567");
    expect(parsed.notifyEmail).toBe("awa@exemple.test");
    expect(parsed.address).toBeNull();
  });

  it("exige le type de pièce quand un numéro est saisi", () => {
    const result = clientSchema.safeParse({ ...base, idDocumentNumber: "123" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["idDocumentType"]);
  });

  it("refuse un téléphone inexploitable avec un message qui dit comment corriger", () => {
    const result = clientSchema.safeParse({ ...base, notifyPhone: "123" });
    expect(result.error?.issues[0]?.message).toMatch(/format international/);
  });

  it("liste les informations manquantes (client complet)", () => {
    const person = {
      kind: "person" as const,
      id_document_type: null,
      id_document_number: null,
      ninea: null,
      rccm: null,
      representative_name: null,
      address: null,
      notify_phone: "+221771234567",
    };
    expect(missingClientInformation(person)).toEqual(["adresse", "pièce d’identité"]);
    expect(
      missingClientInformation({
        ...person,
        kind: "company",
        address: "Dakar",
        ninea: "N1",
        representative_name: "Fatou",
      }),
    ).toEqual([]);
  });
});

describe("véhicule du dossier", () => {
  it("normalise le VIN (majuscules, sans espaces) et convertit année et miles", () => {
    const parsed = vehicleSchema.parse({ vin: "1dem xxx0000000001", modelYear: "2019", mileage: "48 000" });
    expect(parsed.vin).toBe("1DEMXXX0000000001");
    expect(parsed.modelYear).toBe(2019);
    expect(parsed.mileage).toBe(48000);
  });

  it.each(["1DEMXXX000000001", "1DEMIXX0000000001", "1DEMOXX0000000001"])("refuse le VIN « %s »", (vin) =>
    expect(vehicleSchema.safeParse({ vin }).success).toBe(false),
  );

  it("refuse une année improbable", () => {
    expect(vehicleSchema.safeParse({ modelYear: "1890" }).success).toBe(false);
  });
});

describe("acceptation du contrat (R15)", () => {
  const base = {
    dossierId: "11111111-1111-4111-8111-111111111111",
    subject: "contract",
    subjectId: "22222222-2222-4222-8222-222222222222",
    decision: "accepted",
    decidedOn: "2026-10-19",
  };

  it("WhatsApp : exige le numéro émetteur", () => {
    expect(acceptanceSchema.safeParse({ ...base, method: "whatsapp" }).success).toBe(false);
    expect(acceptanceSchema.parse({ ...base, method: "whatsapp", whatsappFrom: "77 123 45 67" }).whatsappFrom).toBe(
      "+221771234567",
    );
  });

  it("contrat : date sans heure → midi à Dakar", () => {
    expect(acceptanceSchema.parse({ ...base, method: "scanned_paper" }).decidedAt.toISOString()).toBe(
      "2026-10-19T12:00:00.000Z",
    );
  });

  it("devis : heure obligatoire et choix d'assurance dans la même acceptation (X1)", () => {
    const quote = { ...base, subject: "quote", method: "scanned_paper" };
    expect(acceptanceSchema.safeParse({ ...quote, insuranceChoice: "accepted" }).success).toBe(false);
    expect(acceptanceSchema.safeParse({ ...quote, decidedTime: "09:45" }).success).toBe(false);
    const parsed = acceptanceSchema.parse({ ...quote, decidedTime: "09:45", insuranceChoice: "refused" });
    expect(parsed.insuranceChoice).toBe("refused");
    expect(parsed.decidedAt.toISOString()).toBe("2026-10-19T09:45:00.000Z");
    // Refus du devis : pas de choix d'assurance à enregistrer.
    expect(
      acceptanceSchema.parse({ ...quote, decision: "refused", decidedTime: "09:45", insuranceChoice: "accepted" })
        .insuranceChoice,
    ).toBeNull();
  });

  it("le portail n'est pas une méthode saisissable par un agent", () => {
    expect(acceptanceSchema.safeParse({ ...base, method: "portal" }).success).toBe(false);
  });

  it("contrôle le fichier de preuve", () => {
    expect(proofFileError(null)).toMatch(/Joignez/);
    expect(proofFileError(new File(["x"], "a.exe", { type: "application/x-msdownload" }))).toMatch(/Format/);
    expect(proofFileError(new File(["x"], "scan.pdf", { type: "application/pdf" }))).toBeNull();
  });
});

describe("ordre d’achat et enchère (US-2.3, US-2.4)", () => {
  const dossierId = "11111111-1111-4111-8111-111111111111";

  it("signature de l’ordre d’achat : les 4 confirmations sont exigées", () => {
    const base = {
      dossierId,
      subject: "purchase_order",
      subjectId: "33333333-3333-4333-8333-333333333333",
      method: "scanned_paper",
      decision: "accepted",
      decidedOn: "2026-10-19",
      ack_vehicle_info: "on",
      ack_import_age: "on",
      ack_binding_win: "on",
    };
    expect(acceptanceSchema.safeParse(base).error?.issues[0]?.message).toMatch(/4 confirmations/);
    expect(acceptanceSchema.parse({ ...base, ack_duties_excluded: "on" }).acknowledgements).toEqual({
      vehicle_info: true,
      import_age: true,
      binding_win: true,
      duties_excluded: true,
    });
    expect(acceptanceSchema.safeParse({ ...base, decision: "refused" }).success).toBe(true);
  });

  it("montants en dollars convertis en centimes, date de l’enchère à l’heure de Dakar", () => {
    const parsed = purchaseOrderSchema.parse({
      dossierId,
      maxBid: "12 450",
      deposit: "3000,50",
      auctionAt: "2026-10-21T15:30",
    });
    expect(parsed.maxBid).toBe(1_245_000);
    expect(parsed.deposit).toBe(300_050);
    expect(parsed.auctionAt).toBe("2026-10-21T15:30:00.000Z");
    expect(purchaseOrderSchema.parse({ dossierId, maxBid: "5000" })).toMatchObject({ deposit: 0, auctionAt: null });
  });

  it.each(["", "0", "-10", "douze"])("refuse l’enchère maximale « %s »", (maxBid) =>
    expect(purchaseOrderSchema.safeParse({ dossierId, maxBid }).success).toBe(false),
  );

  it("lot remporté : prix et date de notification exigés ; lot perdu : rien d’autre", () => {
    const missing = auctionResultSchema.safeParse({ dossierId, result: "won" });
    expect(missing.error?.issues.map((i) => i.path[0])).toEqual(["hammerPrice", "notifiedAt"]);
    expect(
      auctionResultSchema.parse({ dossierId, result: "won", hammerPrice: "8 200", notifiedAt: "2026-10-21T18:05" }),
    ).toMatchObject({ hammerPriceCents: 820_000, notifiedAt: "2026-10-21T18:05:00.000Z", overrideReason: null });
    expect(auctionResultSchema.parse({ dossierId, result: "lost" })).toEqual({ dossierId, result: "lost" });
  });
});
