import { auth, signOut } from "@/auth";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
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
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Dashboard
          </h1>
          <Link
            href="/dashboard/keepa"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            View Keepa data
          </Link>
        </div>
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
          <strong>1)</strong> Keepa bestseller discovery (browse nodes you configure) →
          store Amazon demand in <code className="text-xs">keepa_catalog_items</code>.
          <strong> 2)</strong> Qogita offers → <code className="text-xs">qogita_products</code>.
          <strong> 3)</strong> Match in the database by EAN. Set{" "}
          <code className="text-xs">KEEPA_BESTSELLER_CATEGORY_IDS</code> in{" "}
          <code className="text-xs">.env.local</code>.
        </p>
        <div className="mt-6">
          <SyncQogitaKeepaForm />
        </div>
        <div className="mt-6 grid gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <span className="text-zinc-500">Qogita rows in DB</span>
            <p className="font-mono text-lg">{summary.qogitaOffersInDb}</p>
          </div>
          <div>
            <span className="text-zinc-500">With EAN</span>
            <p className="font-mono text-lg">{summary.withEan}</p>
          </div>
          <div>
            <span className="text-zinc-500">Keepa catalog rows</span>
            <p className="font-mono text-lg">{summary.keepaCatalogRows}</p>
          </div>
          <div>
            <span className="text-zinc-500">Matched ASINs (Qogita)</span>
            <p className="font-mono text-lg">{summary.amazonUkMatches}</p>
          </div>
          <div>
            <span className="text-zinc-500">Keepa match snapshots</span>
            <p className="font-mono text-lg">{summary.withKeepaSnapshot}</p>
          </div>
        </div>
        {summary.qogitaOffersInDb === 0 ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100/90">
            <strong className="font-semibold">No Qogita rows in the database.</strong>{" "}
            The Buyer API call to <code className="text-xs">GET /offers/</code> is
            returning an empty <code className="text-xs">results</code> list for
            your account (HTTP 200, zero offers). That is an API/catalog issue,
            not a failed login — you need offers visible to this endpoint (check
            Qogita account access, buyer programme, or whether another route is
            required). Keepa data can still sync independently; see{" "}
            <Link
              href="/dashboard/keepa"
              className="font-medium underline underline-offset-2"
            >
              Keepa catalog
            </Link>
            .
          </p>
        ) : null}
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
