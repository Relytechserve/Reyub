import { describe, expect, it } from "vitest";

import {
  isReviewedMatch,
  allowReadyToBuyByReviewGate,
  shouldHideRejectedByDefault,
  shouldSkipSyncOverwriteForDecision,
} from "@/lib/sourcing/match-decision-gating";

describe("match decision gating", () => {
  it("hides rejected rows by default", () => {
    expect(shouldHideRejectedByDefault("reject", false)).toBe(true);
    expect(shouldHideRejectedByDefault("approve", false)).toBe(false);
    expect(shouldHideRejectedByDefault(null, false)).toBe(false);
  });

  it("shows rejected rows when explicitly requested", () => {
    expect(shouldHideRejectedByDefault("reject", true)).toBe(false);
  });

  it("does not block global sync when no operator user is configured", () => {
    expect(shouldSkipSyncOverwriteForDecision("reject")).toBe(false);
  });

  it("blocks sync overwrite only for rejecting decision owned by operator user", () => {
    expect(
      shouldSkipSyncOverwriteForDecision("reject", {
        decisionOwnerUserId: "user-a",
        syncOperatorUserId: "user-a",
      })
    ).toBe(true);
    expect(
      shouldSkipSyncOverwriteForDecision("reject", {
        decisionOwnerUserId: "user-a",
        syncOperatorUserId: "user-b",
      })
    ).toBe(false);
    expect(
      shouldSkipSyncOverwriteForDecision("approve", {
        decisionOwnerUserId: "user-a",
        syncOperatorUserId: "user-a",
      })
    ).toBe(false);
    expect(
      shouldSkipSyncOverwriteForDecision(null, {
        decisionOwnerUserId: "user-a",
        syncOperatorUserId: "user-a",
      })
    ).toBe(false);
  });

  it("marks approved decisions as reviewed", () => {
    expect(isReviewedMatch("approve")).toBe(true);
    expect(isReviewedMatch("reject")).toBe(false);
    expect(isReviewedMatch(null)).toBe(false);
  });

  it("gates ready-to-buy rows when review gate enabled", () => {
    expect(allowReadyToBuyByReviewGate("approve", true)).toBe(true);
    expect(allowReadyToBuyByReviewGate("reject", true)).toBe(false);
    expect(allowReadyToBuyByReviewGate(null, true)).toBe(false);
    expect(allowReadyToBuyByReviewGate(null, false)).toBe(true);
  });
});
