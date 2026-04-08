import { describe, expect, it } from "vitest";

import {
  hasConflictReasonTag,
  isSuspiciousMatch,
  scoreBreakdownLabel,
} from "@/lib/sourcing/review-queue";

describe("review queue helpers", () => {
  it("flags medium confidence as suspicious", () => {
    expect(
      isSuspiciousMatch({
        confidence: "medium",
        matchScore: 0.61,
        reasonTags: ["title_token_overlap"],
      })
    ).toBe(true);
  });

  it("flags conflict-tagged matches as suspicious", () => {
    expect(hasConflictReasonTag(["ean_exact", "conflict_brand_mismatch"])).toBe(true);
    expect(
      isSuspiciousMatch({
        confidence: "high",
        matchScore: 0.95,
        reasonTags: ["ean_exact", "conflict_brand_mismatch"],
      })
    ).toBe(true);
  });

  it("formats score breakdown labels", () => {
    const label = scoreBreakdownLabel({
      confidence: "high",
      matchScore: 0.87342,
      reasonTags: ["ean_exact"],
    });
    expect(label).toContain("score=0.8734");
    expect(label).toContain("confidence=high");
    expect(label).toContain("reasons=ean_exact");
  });
});
