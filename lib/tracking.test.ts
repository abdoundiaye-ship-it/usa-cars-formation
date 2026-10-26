import { describe, expect, it } from "vitest";
import {
  arrivalLabel,
  isValidContainerNumber,
  normalizeContainerNumber,
  trackingCheckOverdue,
  trackingLink,
} from "./tracking";

describe("numéro de conteneur ISO 6346 (US-2.6)", () => {
  it.each(["CSQU3054383", "MSKU9070323", "DEMU1234560", "DEMU7654322"])("accepte %s", (n) =>
    expect(isValidContainerNumber(n)).toBe(true),
  );

  it.each(["CSQU3054384", "DEMU1234565", "CSQA3054383", "CSQU305438", "csqu3054383"])("refuse %s", (n) =>
    expect(isValidContainerNumber(n)).toBe(false),
  );

  it("normalise la saisie", () => expect(normalizeContainerNumber(" csqu 305438-3 ")).toBe("CSQU3054383"));
});

describe("lien de suivi construit depuis la configuration du transporteur", () => {
  const container = { number: "CSQU3054383", bl_number: "BL-42" };

  it("lien direct avec le numéro de conteneur", () => {
    expect(
      trackingLink(
        {
          tracking_url: "https://suivi.exemple.test",
          url_template: "https://suivi.exemple.test/{container}",
          link_type: "officiel",
        },
        container,
      ),
    ).toEqual({ url: "https://suivi.exemple.test/CSQU3054383", referenceToEnter: null, thirdParty: false });
  });

  it("lien direct avec le B/L ; sans B/L, page de suivi et référence à saisir", () => {
    const carrier = {
      tracking_url: "https://s.exemple.test",
      url_template: "https://s.exemple.test?bl={bl}",
      link_type: "officiel" as const,
    };
    expect(trackingLink(carrier, container).url).toBe("https://s.exemple.test?bl=BL-42");
    expect(trackingLink(carrier, { ...container, bl_number: null })).toMatchObject({
      url: "https://s.exemple.test",
      referenceToEnter: "CSQU3054383",
    });
  });

  it("service tiers : page de suivi, référence à saisir et mention « service tiers »", () => {
    expect(
      trackingLink({ tracking_url: "https://tiers.exemple.test", url_template: null, link_type: "tiers" }, container),
    ).toEqual({ url: "https://tiers.exemple.test", referenceToEnter: "CSQU3054383", thirdParty: true });
  });
});

describe("ETA indicative et ATA (CLAUDE.md règle 6)", () => {
  it("l’ETA est toujours dite « indicative » tant que l’ATA n’est pas saisie", () => {
    expect(arrivalLabel({ eta: "2026-11-20", ata: null })).toBe("ETA indicative : 20/11/2026");
    expect(arrivalLabel({ eta: "2026-11-20", ata: "2026-11-18" })).toBe("Arrivé le 18/11/2026 (ATA)");
    expect(arrivalLabel({ eta: null, ata: null })).toBe("ETA à confirmer");
  });
});

describe("vérification du suivi (R12)", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const atSea = { status: "at_sea" as const, departed_on: "2026-10-10", ata: null };

  it("alerte si un conteneur en mer n’a pas été vérifié depuis plus de N jours", () => {
    expect(trackingCheckOverdue({ ...atSea, last_checked_at: "2026-10-15T09:00:00Z" }, 3, now)).toBe(true);
    expect(trackingCheckOverdue({ ...atSea, last_checked_at: "2026-10-18T09:00:00Z" }, 3, now)).toBe(false);
  });

  it("pas d’alerte avant le départ ni après l’arrivée", () => {
    expect(
      trackingCheckOverdue(
        { status: "booking_confirmed", departed_on: null, ata: null, last_checked_at: null },
        3,
        now,
      ),
    ).toBe(false);
    expect(
      trackingCheckOverdue({ ...atSea, ata: "2026-10-18", status: "arrived", last_checked_at: null }, 3, now),
    ).toBe(false);
  });
});
