import { and, eq } from "drizzle-orm";

import type { getDb } from "@/db";
import {
  canonicalProducts,
  categorySourceMappings,
  categories,
  productCategoryLinks,
  productExternalRefs,
  qogitaProducts,
} from "@/db/schema";

type Db = ReturnType<typeof getDb>;

/** Resolve internal category id from Qogita slug/key via mapping table or slug match. */
export async function resolveCategoryIdForQogitaSlug(
  db: Db,
  categorySlug: string | null
): Promise<string | null> {
  if (!categorySlug?.trim()) {
    return null;
  }
  const key = categorySlug.trim();

  const mapped = await db
    .select({ categoryId: categorySourceMappings.categoryId })
    .from(categorySourceMappings)
    .where(
      and(
        eq(categorySourceMappings.source, "qogita"),
        eq(categorySourceMappings.sourceKey, key)
      )
    )
    .limit(1);

  if (mapped[0]) {
    return mapped[0].categoryId;
  }

  const bySlug = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, key))
    .limit(1);

  return bySlug[0]?.id ?? null;
}

async function ensureQogitaExternalRef(
  db: Db,
  canonicalId: string,
  qogitaId: string
): Promise<void> {
  await db
    .insert(productExternalRefs)
    .values({
      canonicalProductId: canonicalId,
      source: "qogita",
      externalKey: qogitaId,
    })
    .onConflictDoNothing();
}

async function syncCanonicalMetadata(
  db: Db,
  canonicalId: string,
  qp: { title: string; ean: string | null }
): Promise<void> {
  await db
    .update(canonicalProducts)
    .set({
      title: qp.title,
      ...(qp.ean ? { primaryEan: qp.ean } : {}),
      updatedAt: new Date(),
    })
    .where(eq(canonicalProducts.id, canonicalId));
}

/** Qogita-sourced category becomes primary: clears other primaries for this canonical. */
async function upsertQogitaPrimaryCategory(
  db: Db,
  canonicalId: string,
  categorySlug: string | null
): Promise<void> {
  const categoryId = await resolveCategoryIdForQogitaSlug(db, categorySlug);
  if (!categoryId) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(productCategoryLinks)
      .set({ isPrimary: false })
      .where(eq(productCategoryLinks.canonicalProductId, canonicalId));

    await tx
      .insert(productCategoryLinks)
      .values({
        canonicalProductId: canonicalId,
        categoryId,
        source: "qogita",
        isPrimary: true,
      })
      .onConflictDoUpdate({
        target: [
          productCategoryLinks.canonicalProductId,
          productCategoryLinks.categoryId,
          productCategoryLinks.source,
        ],
        set: { isPrimary: true },
      });
  });
}

/**
 * Ensures a global `canonical_products` row and Qogita external ref for this offer.
 * Merges by EAN when `primary_ean` already exists on another canonical.
 */
export async function ensureCanonicalForQogitaProductId(
  db: Db,
  qogitaProductRowId: string
): Promise<string | null> {
  const rows = await db
    .select()
    .from(qogitaProducts)
    .where(eq(qogitaProducts.id, qogitaProductRowId))
    .limit(1);
  const qp = rows[0];
  if (!qp) {
    return null;
  }

  if (qp.canonicalProductId) {
    await syncCanonicalMetadata(db, qp.canonicalProductId, {
      title: qp.title,
      ean: qp.ean,
    });
    await ensureQogitaExternalRef(db, qp.canonicalProductId, qp.qogitaId);
    await upsertQogitaPrimaryCategory(
      db,
      qp.canonicalProductId,
      qp.categorySlug
    );
    return qp.canonicalProductId;
  }

  const existingRef = await db
    .select({ canonicalProductId: productExternalRefs.canonicalProductId })
    .from(productExternalRefs)
    .where(
      and(
        eq(productExternalRefs.source, "qogita"),
        eq(productExternalRefs.externalKey, qp.qogitaId)
      )
    )
    .limit(1);

  if (existingRef[0]) {
    const cid = existingRef[0].canonicalProductId;
    await db
      .update(qogitaProducts)
      .set({ canonicalProductId: cid, updatedAt: new Date() })
      .where(eq(qogitaProducts.id, qp.id));
    await syncCanonicalMetadata(db, cid, { title: qp.title, ean: qp.ean });
    await upsertQogitaPrimaryCategory(db, cid, qp.categorySlug);
    return cid;
  }

  let canonicalId: string | null = null;
  if (qp.ean) {
    const byEan = await db
      .select({ id: canonicalProducts.id })
      .from(canonicalProducts)
      .where(eq(canonicalProducts.primaryEan, qp.ean))
      .limit(1);
    if (byEan[0]) {
      canonicalId = byEan[0].id;
    }
  }

  if (!canonicalId) {
    const inserted = await db
      .insert(canonicalProducts)
      .values({
        title: qp.title,
        primaryEan: qp.ean,
      })
      .returning({ id: canonicalProducts.id });
    const ins = inserted[0];
    if (!ins) {
      return null;
    }
    canonicalId = ins.id;
  } else {
    await syncCanonicalMetadata(db, canonicalId, {
      title: qp.title,
      ean: qp.ean,
    });
  }

  await db
    .update(qogitaProducts)
    .set({ canonicalProductId: canonicalId, updatedAt: new Date() })
    .where(eq(qogitaProducts.id, qp.id));

  await ensureQogitaExternalRef(db, canonicalId, qp.qogitaId);

  await upsertQogitaPrimaryCategory(db, canonicalId, qp.categorySlug);

  return canonicalId;
}

/** Keepa domain id for Amazon UK (see Keepa API docs). */
export const KEEPA_DOMAIN_UK = 2;

export function amazonExternalKey(domainId: number, asin: string): string {
  return `${domainId}:${asin}`;
}

export async function ensureAmazonExternalRef(
  db: Db,
  canonicalId: string,
  domainId: number,
  asin: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db
    .insert(productExternalRefs)
    .values({
      canonicalProductId: canonicalId,
      source: "amazon",
      externalKey: amazonExternalKey(domainId, asin),
      metadata: metadata ?? null,
    })
    .onConflictDoNothing();
}
