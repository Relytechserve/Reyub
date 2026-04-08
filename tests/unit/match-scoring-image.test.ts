import { describe, expect, it } from "vitest";

import { evaluateMatchCandidate } from "@/lib/matching/match-scoring";

describe("image signal integration", () => {
  it("caps high confidence when image signal is very low", () => {
    const result = evaluateMatchCandidate({
      amazonTitle: "Acme Vitamin C 1000mg Tablets 60 Count",
      qogitaTitle: "Acme Vitamin C 1000mg Tablets 60 Count",
      qogitaBrand: "Acme",
      eanMatch: true,
      fromEanStage: true,
      qogitaUnitsPerPack: 60,
      qogitaPackDescription: "60 count",
      imageSignal: 0.05,
    });
    expect(result.decision).toBe("medium");
    expect(result.reasonTags).toContain("conflict_image");
  });

  it("falls back gracefully when image signal is missing", () => {
    const result = evaluateMatchCandidate({
      amazonTitle: "Acme Vitamin C 1000mg Tablets 60 Count",
      qogitaTitle: "Acme Vitamin C 1000mg Tablets 60 Count",
      qogitaBrand: "Acme",
      eanMatch: true,
      fromEanStage: true,
      qogitaUnitsPerPack: 60,
      qogitaPackDescription: "60 count",
      imageSignal: null,
    });
    expect(result.decision === "high" || result.decision === "medium").toBe(true);
    expect(result.reasonTags).not.toContain("conflict_image");
  });
});
