"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  runQogitaKeepaSync,
  type QogitaKeepaSyncResult,
} from "@/lib/sync/qogita-keepa";

export type { QogitaKeepaSyncResult } from "@/lib/sync/qogita-keepa";

export async function syncQogitaKeepaAction(
  _prev: QogitaKeepaSyncResult | null,
  _formData: FormData
): Promise<QogitaKeepaSyncResult> {
  void _prev;
  void _formData;
  const session = await auth();
  if (!session?.user?.id) {
    return {
      offersFetched: 0,
      qogitaRowsUpserted: 0,
      withEan: 0,
      keepaProductsReturned: 0,
      matchesUpserted: 0,
      errors: ["Not signed in."],
    };
  }

  const result = await runQogitaKeepaSync();
  revalidatePath("/dashboard");
  return result;
}
