import { auth, signOut } from "@/auth";
import { listQogitaKeepaMatches } from "@/lib/sync/qogita-keepa";

import { SyncQogitaKeepaForm } from "./sync-form";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    return null;
  }

  const matches = await listQogitaKeepaMatches(40);

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-col gap-8 px-4 py-12">
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
          Supply (Qogita) ↔ demand (Amazon UK via Keepa)
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Run a sync to pull your Qogita offers, then match GTIN/EAN to Amazon UK
          listings. Rows appear when the same barcode exists on both sides.
        </p>
        <div className="mt-6">
          <SyncQogitaKeepaForm />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Matched products
        </h2>
        {matches.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            No matches yet. Click <strong>Sync Qogita + Keepa</strong> above. You
            need <code className="text-xs">KEEPA_API_KEY</code> set for Amazon
            data.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    EAN
                  </th>
                  <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Qogita (supply)
                  </th>
                  <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Buy €
                  </th>
                  <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Stock
                  </th>
                  <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    ASIN
                  </th>
                  <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Amazon (demand)
                  </th>
                  <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Buy box £
                  </th>
                  <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Rank
                  </th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr
                    key={`${m.qogitaId}-${m.asin}`}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-200">
                      {m.ean ?? "—"}
                    </td>
                    <td className="max-w-[200px] px-3 py-2 text-zinc-800 dark:text-zinc-200">
                      <span className="line-clamp-2" title={m.title}>
                        {m.title}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      {m.buyUnitPrice ?? "—"} {m.currency}
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      {m.stockUnits ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <a
                        href={`https://www.amazon.co.uk/dp/${m.asin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                      >
                        {m.asin}
                      </a>
                    </td>
                    <td className="max-w-[220px] px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      <span className="line-clamp-2" title={m.amazonTitle ?? ""}>
                        {m.amazonTitle ?? "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
                      {m.amazonBuyBoxGbp ? `£${m.amazonBuyBoxGbp}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {m.salesRank?.toLocaleString() ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
