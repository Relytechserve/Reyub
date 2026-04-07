import { auth } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ReyubDocsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/docs");
  }

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-5xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Reyub Docs
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Sourcing Data Dictionary & Formulas
          </h1>
          <Link
            href="/dashboard/sourcing"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Back to Sourcing
          </Link>
        </div>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Reyub = buyer spelled backwards. This page explains every key metric shown
          in the sourcing portal so buying decisions are transparent and auditable.
        </p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-sm dark:border-zinc-800 dark:bg-zinc-900/40 sm:grid-cols-2">
        <div>
          <p className="text-zinc-500">Core signals</p>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Keepa demand + Qogita buy-side
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Default fee model</p>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Flat 15% Amazon selling cost assumption
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Potential score source</p>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Keepa rank drops + BSR strength
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Match trust levels</p>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            High (GTIN) / Medium (title similarity)
          </p>
        </div>
      </section>

      <section id="qogita-buy" className="space-y-4 scroll-mt-24">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          1) Inputs and Parameters
        </h2>
        <div id="units-per-pack" className="sr-only">
          Units per pack anchor
        </div>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-3 py-2 font-medium">Parameter</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["`amazonBuyBoxGbp`", "Keepa", "Current buy box price in GBP when available."],
                ["`avg30BuyBoxGbp`", "Keepa", "30-day average buy box price in GBP (preferred sell reference)."],
                ["`salesRank` (BSR)", "Keepa", "Amazon best seller rank; lower is generally stronger demand."],
                ["`salesRankDrops30`", "Keepa", "How often sales rank drops in 30 days (velocity proxy)."],
                ["`buyUnitPrice`", "Qogita", "Wholesale unit buy price in seller currency (EUR/GBP)."],
                ["`currency`", "Qogita", "Currency for `buyUnitPrice`."],
                ["`unitsPerPack`", "Qogita", "Units represented in one order line/pack."],
                ["`minOrderValueOverride` (MoV)", "Qogita/Excel", "Minimum order value constraint for that listing."],
                ["`priceIncShipping`", "Qogita flags", "When true (Excel import), buy price already includes shipping."],
                ["`eurToGbp`", "User settings", "FX conversion used when Qogita price is in EUR."],
              ].map((row) => (
                <tr
                  key={row[0]}
                  className="border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-3 py-2 font-mono text-xs">{row[0]}</td>
                  <td className="px-3 py-2">{row[1]}</td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          2) Price & Profit Formulas
        </h2>
        <div
          id="sell-reference"
          className="rounded-xl border border-zinc-200 bg-white p-4 text-sm scroll-mt-24 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Sell reference (GBP)
          </p>
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">
            `sell = avg30BuyBoxGbp` if present, otherwise `amazonBuyBoxGbp`.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Buy cost in GBP
          </p>
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">
            If currency is GBP: `buyCostGbp = buyUnitPrice`.  
            If EUR: `buyCostGbp = buyUnitPrice × eurToGbp`.
          </p>
        </div>
        <div
          id="profit-per-unit"
          className="rounded-xl border border-zinc-200 bg-white p-4 text-sm scroll-mt-24 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Estimated profit per unit
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            profitPerUnit = sell × (1 - 0.15) - buyCostGbp
          </p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            `0.15` is current default all-in selling fee assumption.
          </p>
        </div>
        <div
          id="estimated-margin"
          className="rounded-xl border border-zinc-200 bg-white p-4 text-sm scroll-mt-24 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Estimated margin %
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            marginPct = (profitPerUnit / (sell × (1 - 0.15))) × 100
          </p>
        </div>
        <div
          id="profit-per-line"
          className="rounded-xl border border-zinc-200 bg-white p-4 text-sm scroll-mt-24 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Profit per line
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            profitPerLine = profitPerUnit × max(1, unitsPerPack)
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          3) Capital & MoV Calculations
        </h2>
        <div
          id="capital-required"
          className="rounded-xl border border-zinc-200 bg-white p-4 text-sm scroll-mt-24 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Base capital required
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            baseCapital = buyCostGbp × max(1, unitsPerPack)
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Capital required (displayed)
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            capitalRequired = max(baseCapital, minOrderValueOverride)
          </p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            MoV acts as a practical cash constraint even if per-line cost is lower.
          </p>
        </div>
        <div
          id="mov-margin"
          className="rounded-xl border border-zinc-200 bg-white p-4 text-sm scroll-mt-24 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            MoV margin %
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            movMarginPct = (profitPerLine / minOrderValueOverride) × 100
          </p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Only shown when MoV exists.
          </p>
        </div>
      </section>

      <section id="demand-potential" className="space-y-3 scroll-mt-24">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          4) Demand Potential Model
        </h2>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Components
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>
              <strong>Velocity % (V)</strong>: normalized from Keepa `salesRankDrops30`
              (more drops = better).
            </li>
            <li>
              <strong>Rank % (R)</strong>: normalized from BSR (lower rank = better).
            </li>
            <li>
              <strong>Composite % (C)</strong>: `0.62 × V + 0.38 × R`.
            </li>
          </ul>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Tiering logic
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>
              <strong>High potential</strong>: score in top quartile of current dataset
              and minimum velocity guardrail met.
            </li>
            <li>
              <strong>Medium potential</strong>: score in mid-band and minimum
              velocity guardrail met.
            </li>
            <li>
              <strong>Low potential</strong>: falls below medium band or fails
              velocity guardrail.
            </li>
          </ul>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            This is relative to your current matched universe, so labels adapt as
            data grows.
          </p>
        </div>
      </section>

      <section id="match-confidence" className="space-y-3 scroll-mt-24">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          5) Match Confidence & Decision Signals
        </h2>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <ul className="list-inside list-disc space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>
              <strong>High confidence</strong>: GTIN/EAN-based match (preferred for buying).
            </li>
            <li>
              <strong>Medium confidence</strong>: title-similarity heuristic; review before purchase.
            </li>
            <li id="decision-signals" className="scroll-mt-24">
              <strong>Strong buy signal</strong>: high confidence + high potential +
              margin/profit guardrails.
            </li>
            <li>
              <strong>Watch</strong>: decent profile but not top-tier.
            </li>
            <li>
              <strong>Avoid</strong>: weak confidence/potential/profit profile.
            </li>
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">Important caveats</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>These are decision-support estimates, not guaranteed outcomes.</li>
          <li>Fee model is simplified (flat 15%) and excludes full tax/accounting complexity.</li>
          <li>Stock, buy-box, and ranking can change rapidly; sync freshness matters.</li>
          <li>
            Always validate compliance/brand/IP constraints before placing wholesale orders.
          </li>
        </ul>
      </section>
    </div>
  );
}

