"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { getDb } from "@/db";
import { productMatchDecisions, productMatches } from "@/db/schema";

function parseDecision(raw: FormDataEntryValue | null): "approve" | "reject" | null {
  if (raw === "approve" || raw === "reject") {
    return raw;
  }
  return null;
}

export async function upsertMatchDecisionAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return;
  }

  const productMatchIdRaw = formData.get("productMatchId");
  const decision = parseDecision(formData.get("decision"));
  if (typeof productMatchIdRaw !== "string" || !decision) {
    return;
  }

  const notesRaw = formData.get("notes");
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim().slice(0, 500)
      : null;

  const db = getDb();
  const [match] = await db
    .select({ id: productMatches.id })
    .from(productMatches)
    .where(
      and(
        eq(productMatches.id, productMatchIdRaw),
        eq(productMatches.channel, "amazon_uk")
      )
    )
    .limit(1);
  if (!match) {
    return;
  }

  const [existing] = await db
    .select({ id: productMatchDecisions.id })
    .from(productMatchDecisions)
    .where(
      and(
        eq(productMatchDecisions.productMatchId, productMatchIdRaw),
        eq(productMatchDecisions.userId, userId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(productMatchDecisions)
      .set({ decision, notes, updatedAt: new Date() })
      .where(eq(productMatchDecisions.id, existing.id));
  } else {
    await db.insert(productMatchDecisions).values({
      userId,
      productMatchId: productMatchIdRaw,
      decision,
      notes,
    });
  }

  revalidatePath("/dashboard/sourcing");
}
