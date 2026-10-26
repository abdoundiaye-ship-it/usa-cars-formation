import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { xmlStructureError } from "@/lib/documents/well-formed-xml";
import {
  buildLetterData,
  inWords,
  renderLetter,
  type LetterInput,
} from "@/supabase/functions/_shared/unclaimed-letter.ts";

/** Texte brut du document Word généré (corps + en-tête). */
function textOf(bytes: Uint8Array): string {
  const zip = new PizZip(bytes);
  // Un fichier dont une partie XML est mal formée ne s'ouvre pas dans Word.
  for (const part of Object.keys(zip.files).filter((f) => /\.(xml|rels)$/.test(f))) {
    expect(xmlStructureError(zip.file(part)!.asText()), part).toBeNull();
  }
  const xml = ["word/document.xml", "word/header1.xml"].map((f) => zip.file(f)!.asText()).join("");
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
}

const normalize = (value: unknown) => String(value).replace(/\s/g, " ");

const reminder: LetterInput = {
  kind: "reminder",
  number: "LR-2026-0001",
  issuedAt: new Date("2026-10-20T10:00:00Z"),
  legalValidated: false,
  company: {
    legalForm: "SARL (démo)",
    rccm: "SN-DKR-DEMO",
    ninea: "DEMO-NINEA",
    officeAddress: "Dakar (démo)",
    phone: "+221 77 000 00 00",
    email: "contact@exemple.test",
    representativeName: "Gérant Démo",
    representativeTitle: "Gérant",
  },
  client: { name: "Mamadou Diallo (démo)", address: null, notify_phone: "+221770000001" },
  dossier: {
    reference: "DEMO-2026-0007",
    make: "Nissan",
    model: "Qashqai",
    model_year: 2020,
    vin: "1DEMXXX0000000007",
  },
  contractReference: "UC-2026-0007",
  arrivalDate: new Date("2026-08-16T00:00:00Z"),
  reason: "unpaid_not_collected",
  amountDueCents: 300_000,
  lateFeesCents: 0,
  rate: { rate: "600.0000", capturedAt: new Date("2026-10-20T08:00:00Z") },
  formalNoticeDays: 60,
  procedureMonths: 4,
  cureDays: null,
  reminder: null,
};

const notice: LetterInput = {
  ...reminder,
  kind: "formal_notice",
  number: "MD-2026-0001",
  lateFeesCents: 5_000,
  amountDueCents: 305_000,
  cureDays: 15,
  reminder: { number: "LR-2026-0001", sentAt: new Date("2026-09-15T00:00:00Z") },
};

describe("courriers « véhicule non réclamé » (US-5.3, art. 21–22)", () => {
  it("relance : arrivée, sommes dues en USD (équivalent FCFA), délai de la mise en demeure, PROJET", () => {
    const data = buildLetterData(reminder);
    expect(data.titre_document).toBe("LETTRE DE RELANCE N° LR-2026-0001");
    expect(data.projet).toBe(true);
    const paragraphs = (data.paragraphes as { texte: string }[]).map((p) => normalize(p.texte));
    expect(paragraphs[0]).toContain("est arrivé au port de Dakar le 16/08/2026");
    expect(paragraphs[1]).toContain("la somme de 3 000 $US reste due");
    expect(paragraphs[1]).toContain("1 800 000 FCFA au taux du 20/10/2026");
    expect(paragraphs[1]).toContain("le véhicule n’a pas été enlevé");
    expect(paragraphs[3]).toContain("au plus tard soixante (60) jours après l’arrivée");
    const text = textOf(renderLetter(reminder));
    expect(text).toContain("LR-2026-0001");
    expect(text).toContain("PROJET");
    expect(text).not.toMatch(/[{}]|undefined|null|NaN/);
  });

  it("mise en demeure (art. 21) : relance citée, frais accumulés, délai ≥ 15 jours, conséquences (art. 22)", () => {
    const data = buildLetterData({ ...notice, legalValidated: true });
    expect(data.titre_document).toBe("MISE EN DEMEURE N° MD-2026-0001");
    expect(data.projet).toBe(false);
    const all = (data.paragraphes as { texte: string }[]).map((p) => normalize(p.texte)).join(" ");
    expect(all).toContain("lettre de relance n° LR-2026-0001 du 15/09/2026");
    expect(all).toContain("dont 50 $US de frais de retard");
    expect(all).toContain("dans un délai de quinze (15) jours à compter de la réception");
    expect(all).toContain("quatre (4) mois à compter de l’arrivée du véhicule au Sénégal (soit le 16/12/2026)");
    expect(all).toContain("Aucune appropriation automatique du véhicule");
    const text = textOf(renderLetter(notice));
    expect(text).not.toMatch(/[{}]|undefined|null|NaN/);
  });

  it("chaque paragraphe du corps est un paragraphe Word distinct", () => {
    const xml = new PizZip(renderLetter(notice)).file("word/document.xml")!.asText();
    const paragraphs = xml
      .split("</w:p>")
      .map((p) => (p.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join(""));
    const body = buildLetterData(notice).paragraphes as { texte: string }[];
    for (const { texte } of body) expect(paragraphs).toContain(texte);
  });

  it("aucune coordonnée de paiement : seulement le rappel des canaux officiels (règle 7)", () => {
    const all = (buildLetterData(notice).paragraphes as { texte: string }[]).map((p) => p.texte).join(" ");
    expect(all).toContain("compte officiel listé à l’annexe D");
    expect(all).not.toMatch(/IBAN|SN\d{2}|Wave :|Orange Money :/);
  });

  it("véhicule enlevé mais solde dû ; solde réglé mais véhicule non enlevé", () => {
    const unpaid = buildLetterData({ ...reminder, reason: "unpaid" });
    expect(normalize((unpaid.paragraphes as { texte: string }[])[2]!.texte)).toBe(
      "Nous vous invitons à régler les sommes dues dans les meilleurs délais. Les documents du véhicule vous sont remis après le paiement intégral.",
    );
    const notCollected = buildLetterData({ ...reminder, reason: "not_collected", amountDueCents: 0 });
    expect(normalize((notCollected.paragraphes as { texte: string }[])[1]!.texte)).toContain(
      "Aucune somme ne reste due",
    );
  });

  it("mise en demeure incomplète refusée ; nombres en toutes lettres comme dans le contrat", () => {
    expect(() => buildLetterData({ ...notice, reminder: null })).toThrow();
    expect(inWords(15, "jours")).toBe("quinze (15) jours");
    expect(inWords(17, "jours")).toBe("17 jours");
  });
});
