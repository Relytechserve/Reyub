import { describe, expect, it } from "vitest";

import { evaluateMatchCandidate } from "@/lib/matching/match-scoring";

describe("evaluateMatchCandidate", () => {
  it("returns high for true-positive strong match", () => {
    const result = evaluateMatchCandidate({
      amazonTitle: "Acme Vitamin C 1000mg Tablets 60 Pack",
      qogitaTitle: "Acme Vitamin C 1000mg Tablets 60 Count",
      qogitaBrand: "Acme",
      eanMatch: true,
      fromEanStage: true,
      qogitaUnitsPerPack: 60,
      qogitaPackDescription: "60 count bottle",
    });
    expect(result.decision).toBe("high");
    expect(result.weightedScore).toBeGreaterThanOrEqual(0.78);
  });

  it("rejects EAN candidate when semantics strongly conflict", () => {
    const result = evaluateMatchCandidate({
      amazonTitle: "GlowSkin Hyaluronic Face Serum 30ml",
      qogitaTitle: "Turbo Clean Dishwasher Tablets Lemon 80 Pack",
      qogitaBrand: "Turbo Clean",
      eanMatch: true,
      fromEanStage: true,
      qogitaUnitsPerPack: 80,
      qogitaPackDescription: "80 pcs",
    });
    expect(result.decision).toBe("reject_candidate");
    expect(result.reasonTags).toContain("conflict_ean_vs_semantics");
  });

  it("returns medium/high for fuzzy recovery with title+brand alignment", () => {
    const result = evaluateMatchCandidate({
      amazonTitle: "Nivea Men Sensitive Face Wash 100ml",
      qogitaTitle: "Nivea Men Sensitive Face Cleanser 100 ml",
      qogitaBrand: "Nivea",
      eanMatch: false,
      fromEanStage: false,
      qogitaUnitsPerPack: 1,
      qogitaPackDescription: "1 x 100ml",
    });
    expect(["medium", "high"]).toContain(result.decision);
    expect(result.signals.titleSignal).toBeGreaterThan(0.3);
    expect(result.signals.brandSignal).toBeGreaterThan(0.5);
  });

  it("downgrades/rejects when size-pack signal conflicts", () => {
    const result = evaluateMatchCandidate({
      amazonTitle: "Acme Protein Shake 12 x 500ml",
      qogitaTitle: "Acme Protein Shake 6 x 250ml",
      qogitaBrand: "Acme",
      eanMatch: false,
      fromEanStage: false,
      qogitaUnitsPerPack: 6,
      qogitaPackDescription: "6 pack",
    });
    expect(result.signals.sizePackSignal).toBeLessThan(0.4);
    expect(result.reasonTags).toContain("conflict_size_pack");
    expect(["medium", "reject_candidate"]).toContain(result.decision);
  });

  it("rejects ean match when core product-name tokens do not overlap", () => {
    const result = evaluateMatchCandidate({
      amazonTitle: "Lattafa Angham Eau De Parfum 100ml",
      qogitaTitle: "Lattafa Ameerat Al Arab Prive Rose Eau De Parfum 100ml",
      qogitaBrand: "Lattafa",
      eanMatch: true,
      fromEanStage: true,
      qogitaUnitsPerPack: 1,
      qogitaPackDescription: "100ml",
    });
    expect(result.decision).toBe("reject_candidate");
    expect(result.reasonTags).toContain("conflict_core_name");
  });
});
