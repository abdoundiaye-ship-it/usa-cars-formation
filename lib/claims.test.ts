import { describe, expect, it } from "vitest";
import { claimStatusTone, CLAIM_SOURCE_LABELS, CLAIM_STATUS_LABELS, deadlineLabel } from "./claims";

describe("réclamations (lot 6d)", () => {
  it("libellés et tons des statuts", () => {
    expect(CLAIM_STATUS_LABELS.open).toBe("Reçue");
    expect(CLAIM_STATUS_LABELS.resolved).toBe("Résolue");
    expect(CLAIM_SOURCE_LABELS.client).toBe("Client");
    expect(claimStatusTone("resolved")).toBe("success");
    expect(claimStatusTone("rejected")).toBe("danger");
    expect(claimStatusTone("forwarded")).toBe("warning");
    expect(claimStatusTone("open")).toBe("info");
  });

  it("libellé de délai (art. 19)", () => {
    expect(deadlineLabel(false)).toBe("Dans le délai");
    expect(deadlineLabel(true)).toBe("Hors délai");
  });
});
