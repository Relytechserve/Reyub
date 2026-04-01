import { NextResponse } from "next/server";

/**
 * Daily sync entry point (07:00 UK — configured in vercel.json).
 * Implement Qogita / Keepa / eBay ingestion and scoring here.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    message: "Sync stub — wire ingestion and sku_scores in a later iteration.",
  });
}
