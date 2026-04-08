import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { productMatchFeedbackEvents, productMatches } from "@/db/schema";
import { isSuspiciousMatch } from "@/lib/sourcing/review-queue";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

type FeedbackRow = {
  action: "approve" | "reject" | "remap";
  decision: "approve" | "reject" | null;
  reasonTags: string[];
  scoreSnapshot: {
    confidence: "high" | "medium";
    matchScore: number | null;
    reasonTags: string[];
  };
};

function sampleRows(): FeedbackRow[] {
  return [
    { action: "approve", decision: "approve", reasonTags: ["good_pack_match"], scoreSnapshot: { confidence: "high", matchScore: 0.94, reasonTags: ["ean_exact"] } },
    { action: "reject", decision: "reject", reasonTags: ["title_mismatch"], scoreSnapshot: { confidence: "medium", matchScore: 0.42, reasonTags: ["title_token_overlap"] } },
    { action: "reject", decision: "reject", reasonTags: ["brand_conflict"], scoreSnapshot: { confidence: "high", matchScore: 0.58, reasonTags: ["conflict_brand_mismatch"] } },
    { action: "approve", decision: "approve", reasonTags: ["manual_verified"], scoreSnapshot: { confidence: "high", matchScore: 0.89, reasonTags: ["ean_exact"] } },
    { action: "remap", decision: null, reasonTags: ["wrong_supplier_variant"], scoreSnapshot: { confidence: "high", matchScore: 0.76, reasonTags: ["title_token_overlap"] } },
  ];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function reasonHistogram(rows: FeedbackRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const tag of row.reasonTags) {
      out[tag] = (out[tag] ?? 0) + 1;
    }
    for (const tag of row.scoreSnapshot.reasonTags) {
      out[tag] = (out[tag] ?? 0) + 1;
    }
  }
  return out;
}

async function main() {
  let rows: FeedbackRow[];
  if (!process.env.DATABASE_URL?.trim()) {
    rows = sampleRows();
  } else {
    try {
      const db = getDb();
      const dbRows = await db
        .select({
          action: productMatchFeedbackEvents.action,
          decision: productMatchFeedbackEvents.decision,
          reasonTags: productMatchFeedbackEvents.reasonTags,
          scoreSnapshot: productMatchFeedbackEvents.scoreSnapshot,
        })
        .from(productMatchFeedbackEvents)
        .innerJoin(
          productMatches,
          and(eq(productMatches.id, productMatchFeedbackEvents.productMatchId), eq(productMatches.channel, "amazon_uk"))
        );
      rows = dbRows.map((r) => ({
        action: r.action,
        decision: r.decision,
        reasonTags: Array.isArray(r.reasonTags) ? (r.reasonTags as string[]) : [],
        scoreSnapshot: (r.scoreSnapshot ?? {
          confidence: "medium",
          matchScore: null,
          reasonTags: [],
        }) as FeedbackRow["scoreSnapshot"],
      }));
    } catch {
      rows = sampleRows();
    }
  }

  const approved = rows.filter((r) => r.decision === "approve");
  const rejected = rows.filter((r) => r.decision === "reject");
  const suspicious = rows.filter((r) => isSuspiciousMatch(r.scoreSnapshot));
  const approveScores = approved
    .map((r) => r.scoreSnapshot.matchScore)
    .filter((v): v is number => typeof v === "number");
  const rejectScores = rejected
    .map((r) => r.scoreSnapshot.matchScore)
    .filter((v): v is number => typeof v === "number");

  const recommendedMinScore = Math.max(0.3, Math.min(0.98, (avg(approveScores) + avg(rejectScores)) / 2));
  const report = {
    generatedAt: new Date().toISOString(),
    rowsAnalyzed: rows.length,
    queueSizeSuspicious: suspicious.length,
    outcomes: {
      approved: approved.length,
      rejected: rejected.length,
      remapped: rows.filter((r) => r.action === "remap").length,
    },
    scorePatterns: {
      avgApprovedScore: avg(approveScores),
      avgRejectedScore: avg(rejectScores),
      recommendedMinScore,
    },
    reasonTagHistogram: reasonHistogram(rows),
    recommendations: [
      `Raise auto-approve score floor to >= ${recommendedMinScore.toFixed(3)} when confidence=high.`,
      "Route all medium-confidence matches to Suspicious queue.",
      "Penalize conflict_* reason tags in weighted scoring and require review override.",
    ],
  };

  const outDir = resolve(process.cwd(), "artifacts");
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, "threshold-calibration-report.json");
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        queueSizeSuspicious: report.queueSizeSuspicious,
        outcomes: report.outcomes,
        reportPath: outPath,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
