"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

type Props = {
  showMargin: boolean;
  minMarginPct: number;
};

export function DashboardFilters({ showMargin, minMarginPct }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pushParams = useCallback(
    (next: Record<string, string | undefined>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === "") {
          p.delete(k);
        } else {
          p.set(k, v);
        }
      }
      startTransition(() => {
        router.push(`/dashboard?${p.toString()}`);
      });
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        View options
      </p>
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            className="size-4 rounded border-zinc-300"
            checked={showMargin}
            disabled={pending}
            onChange={(e) =>
              pushParams({
                margin: e.target.checked ? "1" : undefined,
                min: e.target.checked ? String(minMarginPct || 0) : undefined,
              })
            }
          />
          Show margin estimate
        </label>

        {showMargin ? (
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <span className="whitespace-nowrap">Min. net margin %</span>
            <input
              type="number"
              min={-100}
              max={99}
              step={1}
              defaultValue={minMarginPct}
              disabled={pending}
              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              onBlur={(e) => {
                const v = Number.parseFloat(e.target.value);
                if (!Number.isFinite(v)) {
                  return;
                }
                pushParams({ margin: "1", min: String(v) });
              }}
            />
          </label>
        ) : null}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Margin uses Buy Box £, Qogita unit € × a fixed EUR→GBP rate (~0.85 unless set
        in account settings), and ~15% Amazon fees — indicative only.
      </p>
    </div>
  );
}
