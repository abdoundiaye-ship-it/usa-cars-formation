import { FunctionsHttpError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ functions: { invoke } }),
}));

const { generateDocument } = await import("./contracts");

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status }));

describe("appel de la fonction generate-document", () => {
  beforeEach(() => invoke.mockReset());

  it("renvoie l’identifiant du document généré", async () => {
    invoke.mockResolvedValueOnce({ data: { id: "doc-1" }, error: null });
    await expect(generateDocument("d", "contract")).resolves.toEqual({ ok: true, id: "doc-1" });
  });

  it("réessaie une fois quand la fonction a dépassé ses limites (démarrage à froid, code 546)", async () => {
    invoke
      .mockResolvedValueOnce({ data: null, error: httpError(546, { message: "Worker failed to respond" }) })
      .mockResolvedValueOnce({ data: { id: "doc-2" }, error: null });
    await expect(generateDocument("d", "purchase_order")).resolves.toEqual({ ok: true, id: "doc-2" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("ne réessaie pas une règle métier et transmet son message à l’agent", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError(409, { message: "Complétez le véhicule avant de générer l’ordre d’achat : le VIN." }),
    });
    await expect(generateDocument("d", "purchase_order")).resolves.toEqual({
      ok: false,
      message: "Complétez le véhicule avant de générer l’ordre d’achat : le VIN.",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
