import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatUsd, formatXof } from "./format";

const NBSP = " ";

describe("formatage français (CLAUDE.md §5)", () => {
  it("formate les montants USD", () => {
    expect(formatUsd(1_245_000)).toBe(`12${NBSP}450${NBSP}$US`);
    expect(formatUsd(1_245_050)).toBe(`12${NBSP}450,50${NBSP}$US`);
    expect(formatUsd(0)).toBe(`0${NBSP}$US`);
  });

  it("formate les montants FCFA", () => {
    expect(formatXof(7_302_000)).toBe(`7${NBSP}302${NBSP}000${NBSP}FCFA`);
  });

  it("formate les dates en JJ/MM/AAAA, fuseau Africa/Dakar (UTC+0)", () => {
    expect(formatDate("2026-10-17T23:30:00Z")).toBe("17/10/2026");
    expect(formatDate(new Date("2026-01-05T00:00:00Z"))).toBe("05/01/2026");
    expect(formatDateTime("2026-10-13T10:10:00Z")).toBe("13/10/2026 10:10");
  });
});
