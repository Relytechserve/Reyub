export type MatchDecision = "approve" | "reject" | null;

export function shouldHideRejectedByDefault(
  decision: MatchDecision,
  showRejected: boolean
): boolean {
  return !showRejected && decision === "reject";
}

export function shouldSkipSyncOverwriteForDecision(
  decision: MatchDecision,
  options?: {
    decisionOwnerUserId?: string | null;
    syncOperatorUserId?: string | null;
  }
): boolean {
  if (decision !== "reject") {
    return false;
  }
  // Global matcher mode: no operator context means user decisions are ignored.
  if (!options?.syncOperatorUserId) {
    return false;
  }
  return options.decisionOwnerUserId === options.syncOperatorUserId;
}

export function isReviewedMatch(decision: MatchDecision): boolean {
  return decision === "approve";
}
