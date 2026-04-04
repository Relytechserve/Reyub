import { auth } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { qogitaOffersEntryPath } from "@/lib/qogita/offers";
import { listKeepaCatalogPage } from "@/lib/sync/qogita-keepa";

import { KeepaCatalogTable } from "./keepa-catalog-table";

const PAGE_SIZE = 50;

export default async function KeepaDataPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/keepa");
  }

  const sp = await searchParams;
  const pageRaw = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const { rows, total } = await listKeepaCatalogPage(PAGE_SIZE, offset);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const offersPath = qogitaOffersEntryPath();

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-7xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Dashboard
        </Link>
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Reyub
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Keepa catalog data
        </h1>
        <p className="max-w-3xl text-zinc-600 dark:text-zinc-400">
          Rows from <code className="text-xs">keepa_catalog_items</code> (Amazon
          demand from bestseller discovery + Keepa product stats). Sorted by{" "}
          <strong>last captured</strong> (newest first). For velocity-ranked Top
          20, use the main dashboard.
        </p>
      </header>

      <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 dark:border-amber-900/50 dark:bg-amber-950/30">
        <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">
          Why is there no Qogita data?
        </h2>
        <p className="mt-2 text-sm text-amber-950/90 dark:text-amber-100/90">
          This app loads wholesale offers from{" "}
          <code className="rounded bg-amber-100 px-1 text-xs dark:bg-amber-900/60">
            GET https://api.qogita.com{offersPath}
          </code>
          . If that response has <strong>count: 0</strong> and{" "}
          <strong>results: []</strong>, nothing is written to{" "}
          <code className="text-xs">qogita_products</code> — that is normal when
          your buyer account has no offers visible to the Buyer API (e.g. no
          allocations, wrong environment, or a different endpoint is required).
          Login and credentials can succeed while still returning an empty list.
          Keepa rows below are independent and do not require Qogita.
        </p>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-mono text-zinc-900 dark:text-zinc-100">
              {total}
            </span>{" "}
            ASINs in database · page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`/dashboard/keepa?page=${page - 1}`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Previous
              </Link>
            ) : (
              <span className="rounded-lg border border-transparent px-3 py-1.5 text-sm text-zinc-400">
                Previous
              </span>
            )}
            {page < totalPages ? (
              <Link
                href={`/dashboard/keepa?page=${page + 1}`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-lg border border-transparent px-3 py-1.5 text-sm text-zinc-400">
                Next
              </span>
            )}
          </div>
        </div>
        <KeepaCatalogTable rows={rows} />
      </section>
    </div>
  );
}
