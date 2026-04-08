"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { getDb } from "@/db";
import {
  productMatchDecisions,
  productMatchFeedbackEvents,
  productMatches,
  qogitaProducts,
} from "@/db/schema";

function parseDecision(raw: FormDataEntryValue | null): "approve" | "reject" | null {
  if (raw === "approve" || raw === "reject") {
    return raw;
  }
  return null;
}

function parseReasonTags(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, 10);
}

function isMissingDecisionSchemaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("product_match_decisions") ||
    msg.includes("product_match_feedback_events") ||
    msg.includes("user_id")
  );
}

function parseQogitaProductUrl(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (host !== "qogita.com" && !host.endsWith(".qogita.com")) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function upsertMatchDecisionAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return;
  }

  const productMatchIdRaw = formData.get("productMatchId");
  const decision = parseDecision(formData.get("decision"));
  const actionRaw = formData.get("action");
  const action =
    actionRaw === "remap"
      ? "remap"
      : actionRaw === "update_link"
        ? "update_link"
        : decision;
  if (typeof productMatchIdRaw !== "string" || !action) {
    return;
  }
  const reasonTags = parseReasonTags(formData.get("reasonTags"));

  const notesRaw = formData.get("notes");
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim().slice(0, 500)
      : null;

  const db = getDb();
  const [match] = await db
    .select({
      id: productMatches.id,
      confidence: productMatches.confidence,
      matchScore: productMatches.matchScore,
      reasonTags: productMatches.reasonTags,
      qogitaProductId: productMatches.qogitaProductId,
    })
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

  let remappedQogitaProductId: string | null = null;
  if (action === "remap") {
    const remapQogitaIdRaw = formData.get("remapQogitaId");
    const remapQogitaId = typeof remapQogitaIdRaw === "string" ? remapQogitaIdRaw.trim() : "";
    if (!remapQogitaId) {
      return;
    }
    const [target] = await db
      .select({ id: qogitaProducts.id })
      .from(qogitaProducts)
      .where(eq(qogitaProducts.qogitaId, remapQogitaId))
      .limit(1);
    if (!target) {
      return;
    }
    remappedQogitaProductId = target.id;
    await db
      .update(productMatches)
      .set({ qogitaProductId: remappedQogitaProductId, updatedAt: new Date() })
      .where(eq(productMatches.id, productMatchIdRaw));
  }
  if (action === "update_link") {
    const nextLink = parseQogitaProductUrl(formData.get("qogitaProductUrl"));
    if (!nextLink || !match.qogitaProductId) {
      return;
    }
    const [qp] = await db
      .select({ flags: qogitaProducts.flags })
      .from(qogitaProducts)
      .where(eq(qogitaProducts.id, match.qogitaProductId))
      .limit(1);
    const existingFlags =
      qp?.flags && typeof qp.flags === "object"
        ? (qp.flags as Record<string, unknown>)
        : {};
    await db
      .update(qogitaProducts)
      .set({
        flags: {
          ...existingFlags,
          productLink: nextLink,
        },
        updatedAt: new Date(),
      })
      .where(eq(qogitaProducts.id, match.qogitaProductId));
  }

  if (decision) {
    try {
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
    } catch (e) {
      if (!isMissingDecisionSchemaError(e)) {
        throw e;
      }
    }
  }

  const scoreReasonTags = Array.isArray(match.reasonTags)
    ? match.reasonTags.filter((t): t is string => typeof t === "string")
    : [];
  if (action === "approve" || action === "reject" || action === "remap") {
    try {
      await db.insert(productMatchFeedbackEvents).values({
        userId,
        productMatchId: productMatchIdRaw,
        action,
        decision: decision ?? null,
        reasonTags,
        scoreSnapshot: {
          confidence: match.confidence,
          matchScore: match.matchScore,
          reasonTags: scoreReasonTags,
        },
        notes,
        previousQogitaProductId: match.qogitaProductId,
        remappedQogitaProductId,
      });
    } catch (e) {
      if (!isMissingDecisionSchemaError(e)) {
        throw e;
      }
    }
  }

  revalidatePath("/dashboard/sourcing");
}
