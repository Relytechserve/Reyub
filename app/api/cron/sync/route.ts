import { NextResponse } from "next/server";

import { runQogitaKeepaSync } from "@/lib/sync/qogita-keepa";

/**
 * Daily sync (07:00 UTC in vercel.json — adjust for UK). Set CRON_SECRET and
 * Authorization: Bearer <CRON_SECRET> for non-Vercel callers.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runQogitaKeepaSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
