"use client";

import { useFormState, useFormStatus } from "react-dom";

import {
  syncQogitaKeepaAction,
  type QogitaKeepaSyncResult,
} from "@/app/actions/sync-products";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
    >
      {pending ? "Syncing…" : "Sync Qogita + Keepa (UK)"}
    </button>
  );
}

const initial: QogitaKeepaSyncResult | null = null;

export function SyncQogitaKeepaForm() {
  const [state, formAction] = useFormState(syncQogitaKeepaAction, initial);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Fetches offers from Qogita, saves to DB, matches EANs on Amazon UK via
          Keepa.
        </p>
      </form>
      {state ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Last sync
          </p>
          <ul className="mt-2 list-inside list-disc text-zinc-700 dark:text-zinc-300">
            <li>Offers pulled: {state.offersFetched}</li>
            <li>Qogita rows upserted: {state.qogitaRowsUpserted}</li>
            <li>With EAN: {state.withEan}</li>
            <li>Keepa products returned: {state.keepaProductsReturned}</li>
            <li>Amazon listings saved (Keepa snapshot): {state.keepaRowsSaved}</li>
            <li>Of those, with Qogita offer (same GTIN): {state.matchesUpserted}</li>
          </ul>
          {state.errors.length > 0 ? (
            <ul className="mt-3 list-inside list-disc text-amber-800 dark:text-amber-200">
              {state.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
