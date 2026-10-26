import { describe, expect, it } from "vitest";
import { compareCounts, isSafeObjectPath, manifestSummary, retrying } from "./backup";

describe("sauvegardes (G3-a)", () => {
  it("n’écrit jamais un fichier hors du dossier de sauvegarde", () => {
    expect(isSafeObjectPath("clients/c1/dossiers/d1/contrat-v1.docx")).toBe(true);
    expect(isSafeObjectPath("../etc/passwd")).toBe(false);
    expect(isSafeObjectPath("a/../../b")).toBe(false);
    expect(isSafeObjectPath("/absolu")).toBe(false);
    expect(isSafeObjectPath("a\\b")).toBe(false);
    expect(isSafeObjectPath("a//b")).toBe(false);
    expect(isSafeObjectPath("facture:1.pdf")).toBe(false);
    expect(isSafeObjectPath("")).toBe(false);
  });

  it("restauration complète : chaque table entre les comptages avant et après la copie", () => {
    const before = { "public.dossiers": 3, "public.audit_log": 10, "auth.users": 2 };
    const after = { "public.dossiers": 3, "public.audit_log": 12, "auth.users": 2 };
    expect(compareCounts(before, after, { "public.dossiers": 3, "public.audit_log": 11, "auth.users": 2 })).toEqual([]);
  });

  it("signale une table absente ou incomplète", () => {
    const before = { "public.dossiers": 3, "public.audit_log": 10 };
    expect(compareCounts(before, before, { "public.dossiers": 2 })).toEqual([
      "public.audit_log : table absente de la base restaurée",
      "public.dossiers : 2 ligne(s) restaurée(s), 3 attendue(s)",
    ]);
    expect(
      compareCounts(
        before,
        { "public.dossiers": 5, "public.audit_log": 10 },
        { "public.dossiers": 6, "public.audit_log": 10 },
      ),
    ).toEqual(["public.dossiers : 6 ligne(s) restaurée(s), 3 à 5 attendue(s)"]);
  });

  it("relance un appel Storage en erreur, puis abandonne après 3 essais", async () => {
    let calls = 0;
    const flaky = () => Promise.resolve(++calls < 2 ? { data: null, error: "fetch failed" } : { data: 1, error: null });
    expect(await retrying(flaky, 3, 0)).toEqual({ data: 1, error: null });
    calls = 0;
    const down = () => Promise.resolve({ data: null, error: `essai ${++calls}` });
    expect(await retrying(down, 3, 0)).toEqual({ data: null, error: "essai 3" });
  });

  it("résume le manifeste des fichiers", () => {
    expect(
      manifestSummary({
        createdAt: "2026-10-22T02:00:00Z",
        buckets: [
          {
            id: "documents",
            public: false,
            fileSizeLimit: null,
            allowedMimeTypes: null,
            objects: [
              { name: "a.pdf", contentType: "application/pdf", size: 1_048_576, sha256: "0".repeat(64) },
              { name: "b.pdf", contentType: "application/pdf", size: 524_288, sha256: "1".repeat(64) },
            ],
          },
        ],
      }),
    ).toBe("1 compartiment(s), 2 fichier(s), 1,5 Mo");
  });
});
