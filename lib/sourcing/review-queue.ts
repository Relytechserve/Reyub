export type MatchScoreSnapshot = {
  confidence: "high" | "medium";
  matchScore: number | null;
  reasonTags: string[];
};

export function hasConflictReasonTag(reasonTags: string[]): boolean {
  return reasonTags.some((tag) => tag.startsWith("conflict_"));
}

export function isSuspiciousMatch(snapshot: MatchScoreSnapshot): boolean {
  return snapshot.confidence !== "high" || hasConflictReasonTag(snapshot.reasonTags);
}

export function scoreBreakdownLabel(snapshot: MatchScoreSnapshot): string {
  const score = snapshot.matchScore == null ? "n/a" : snapshot.matchScore.toFixed(4);
  const reasons = snapshot.reasonTags.length > 0 ? snapshot.reasonTags.join(", ") : "none";
  return `score=${score} | confidence=${snapshot.confidence} | reasons=${reasons}`;
}
