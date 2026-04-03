import { auth, signOut } from "@/auth";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDb } from "@/db";
import { userSettings } from "@/db/schema";
import {
  DEFAULT_EUR_TO_GBP,
  estimateAmazonNetMarginPct,
  parseEurPrice,
  parseGbpToNumber,
} from "@/lib/margin/estimate";
import {
  getDashboardInventorySummary,
  getLatestSyncRun,
  listRecentQogitaExtractions,
  listTopKeepaDashboardRows,
} from "@/lib/sync/qogita-keepa";

import { DashboardFilters } from "./dashboard-filters";
import { ExtractionDiagnostics } from "./extraction-diagnostics";
import { KeepaTopTable } from "./keepa-table";
import { SyncQogitaKeepaForm } from "./sync-form";

type SearchParams = {
  margin?: string;
  min?: string;
};

function parseFxEurToGbp(raw: unknown): number {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_EUR_TO_GBP;
  }
  const o = raw as Record<string, unknown>;
  const v = o.EUR ?? o.eur;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v;
  }
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return DEFAULT_EUR_TO_GBP;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const sp = await searchParams;
  const showMargin = sp.margin === "1" || sp.margin === "true";
  const minMarginPct = Number.parseFloat(sp.min ?? "0");
  const minM = Number.isFinite(minMarginPct) ? minMarginPct : 0;

  const db = getDb();
  const [settings] = await db
    .select({ fxManual: userSettings.fxManual })
    .from(userSettings)
    .where(eq(userSettings.userId, session.user.id))
    .limit(1);

  const eurToGbp = parseFxEurToGbp(settings?.fxManual);

  const pool = await listTopKeepaDashboardRows(120);
  const enriched = pool.map((row) => {
    const gbp = parseGbpToNumber(row.amazonBuyBoxGbp);
    const eur = parseEurPrice(row.buyUnitPrice);
    let estimatedMarginPct: number | null = null;
    if (gbp != null && eur != null && row.qogitaId) {
      estimatedMarginPct = estimateAmazonNetMarginPct({
        amazonBuyBoxGbp: gbp,
        buyUnitEur: eur,
        eurToGbp,
      });
    }
    return { ...row, estimatedMarginPct };
  });

  const marginFiltered =
    showMargin && minM > 0
      ? enriched.filter(
          (r) =>
            r.estimatedMarginPct != null && r.estimatedMarginPct >= minM
        )
      : enriched;

  const topRows = marginFiltered.slice(0, 20);

  const [summary, latestRun, qogitaSamples] = await Promise.all([
    getDashboardInventorySummary(),
    getLatestSyncRun(),
    listRecentQogitaExtractions(15),
  ]);

  const envHints = {
    keepaKeyPresent: Boolean(process.env.KEEPA_API_KEY?.trim()),
    qogitaAuthPresent:
      (Boolean(process.env.QOGITA_EMAIL?.trim()) &&
        Boolean(process.env.QOGITA_PASSWORD?.trim())) ||
      Boolean(process.env.QOGITA_API_TOKEN?.trim()),
  };

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-7xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Reyub
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Dashboard
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Signed in as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {session.user.email}
          </span>
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="mt-2"
        >
          <button
            type="submit"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Sync data
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Pull Qogita offers, call Keepa for every offer EAN, and store{" "}
          <strong>all</strong> Amazon UK listings Keepa returns (with or without a
          Qogita match). Top 20 below rank by recent sales velocity (30-day rank
          drops), then sales rank.
        </p>
        <div className="mt-6">
          <SyncQogitaKeepaForm />
        </div>
        <div className="mt-6 grid gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-zinc-500">Qogita rows in DB</span>
            <p className="font-mono text-lg">{summary.qogitaOffersInDb}</p>
          </div>
          <div>
            <span className="text-zinc-500">With EAN</span>
            <p className="font-mono text-lg">{summary.withEan}</p>
          </div>
          <div>
            <span className="text-zinc-500">Amazon UK ASINs</span>
            <p className="font-mono text-lg">{summary.amazonUkMatches}</p>
          </div>
          <div>
            <span className="text-zinc-500">With Keepa snapshot</span>
            <p className="font-mono text-lg">{summary.withKeepaSnapshot}</p>
          </div>
        </div>
        {summary.withEan === 0 && summary.qogitaOffersInDb > 0 ? (
          <p className="mt-4 text-sm text-amber-800 dark:text-amber-200">
            Your Qogita offers have no barcodes in the fields we read — the table
            will stay empty until EAN/GTIN is present on offers or the mapper is
            extended for your payload shape.
          </p>
        ) : null}
      </section>

      <ExtractionDiagnostics
        latestRun={latestRun}
        qogitaSamples={qogitaSamples}
        envHints={envHints}
      />

      <Suspense fallback={null}>
        <DashboardFilters showMargin={showMargin} minMarginPct={minM} />
      </Suspense>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Top 20 Amazon (Keepa) — demand vs Qogita sourcing
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {showMargin && minM > 0
            ? `Filtered to estimated net margin ≥ ${minM}% (from ${pool.length} Keepa listings ranked by velocity).`
            : `Ranked by 30-day sales rank drops (higher = more activity), then lower BSR.`}
        </p>
        <KeepaTopTable rows={topRows} showMargin={showMargin} />
      </section>
    </div>
  );
}
