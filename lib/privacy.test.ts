import { describe, expect, it } from "vitest";
import { noticeValue, retentionText } from "./privacy";

describe("page Confidentialité (G1-a, G2-a)", () => {
  it("n’affiche pas une coordonnée vide ou « À compléter »", () => {
    expect(noticeValue("contact@exemple.test")).toBe("contact@exemple.test");
    expect(noticeValue("  Dakar  ")).toBe("Dakar");
    expect(noticeValue("À compléter")).toBeNull();
    expect(noticeValue("")).toBeNull();
    expect(noticeValue(null)).toBeNull();
  });

  it("écrit la durée de conservation, sans valeur en dur", () => {
    expect(retentionText(10)).toBe("10 ans");
    expect(retentionText(1)).toBe("1 an");
    expect(retentionText(null)).toBe("durée à préciser");
    expect(retentionText(2.5)).toBe("durée à préciser");
  });
});
