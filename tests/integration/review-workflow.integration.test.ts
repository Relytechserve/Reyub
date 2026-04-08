import { describe, expect, it } from "vitest";

import { allowReadyToBuyByReviewGate } from "@/lib/sourcing/match-decision-gating";
import { isSuspiciousMatch } from "@/lib/sourcing/review-queue";

type Row = {
  decision: "approve" | "reject" | null;
  confidence: "high" | "medium";
  matchScore: number | null;
  reasonTags: string[];
  potential: "High" | "Medium" | "Low";
  estimatedMarginPct: number;
  estimatedProfitPerLineGbp: number;
};

describe("review workflow integration", () => {
  it("filters suspicious queue and applies ready-to-buy review gate", () => {
    const rows: Row[] = [
      {
        decision: null,
        confidence: "medium",
        matchScore: 0.44,
        reasonTags: ["title_token_overlap"],
        potential: "Medium",
        estimatedMarginPct: 8,
        estimatedProfitPerLineGbp: 3,
      },
      {
        decision: "approve",
        confidence: "high",
        matchScore: 0.93,
        reasonTags: ["ean_exact"],
        potential: "High",
        estimatedMarginPct: 16,
        estimatedProfitPerLineGbp: 9,
      },
      {
        decision: null,
        confidence: "high",
        matchScore: 0.81,
        reasonTags: ["conflict_brand_mismatch"],
        potential: "High",
        estimatedMarginPct: 15,
        estimatedProfitPerLineGbp: 8,
      },
    ];

    const suspicious = rows.filter((r) =>
      isSuspiciousMatch({
        confidence: r.confidence,
        matchScore: r.matchScore,
        reasonTags: r.reasonTags,
      })
    );
    expect(suspicious).toHaveLength(2);

    const readyToBuy = rows.filter(
      (r) =>
        r.confidence === "high" &&
        r.potential === "High" &&
        r.estimatedMarginPct >= 10 &&
        r.estimatedProfitPerLineGbp >= 5 &&
        allowReadyToBuyByReviewGate(r.decision, true)
    );
    expect(readyToBuy).toHaveLength(1);
    expect(readyToBuy[0]?.decision).toBe("approve");
  });
});
