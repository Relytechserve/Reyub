/**
 * Keepa Category API — child browse nodes for expanding bestseller discovery.
 * @see https://keepa.com/#!api
 */

const KEEPA_BASE = "https://api.keepa.com";

export type CategoryLookupResponse = {
  /** Map keyed by string category id → metadata (common Keepa shape). */
  categories?: Record<
    string,
    {
      catId?: number;
      children?: number[];
      name?: string;
    }
  >;
  /** Alternate REST shape: main node + sibling child entries. */
  category?: {
    catId?: number;
    categoryId?: number;
    children?: number[];
  };
  children?: Array<number | { categoryId?: number; catId?: number }>;
  error?: { message?: string; type?: string };
};

function normalizeChildIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "number" && Number.isFinite(x)) {
      out.push(String(Math.trunc(x)));
      continue;
    }
    if (typeof x === "string") {
      const d = x.replace(/\D/g, "");
      if (d) {
        out.push(d);
      }
      continue;
    }
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const id = o.categoryId ?? o.catId;
      if (typeof id === "number" && Number.isFinite(id)) {
        out.push(String(Math.trunc(id)));
      }
    }
  }
  return out;
}

/**
 * Direct child category browse node IDs for an Amazon category on the given domain.
 * If the API returns no children (leaf), returns an empty array.
 */
export async function fetchDirectChildCategoryIds(
  apiKey: string,
  domain: number,
  categoryId: string
): Promise<string[]> {
  const clean = categoryId.replace(/\D/g, "") || categoryId;
  const params = new URLSearchParams({
    key: apiKey,
    domain: String(domain),
    category: clean,
    /** Ask Keepa to include child category ids when supported. */
    children: "1",
  });

  const res = await fetch(`${KEEPA_BASE}/category?${params}`);
  const json = (await res.json()) as CategoryLookupResponse;

  if (json.error?.message) {
    throw new Error(
      `Keepa category: ${json.error.message}${json.error.type ? ` (${json.error.type})` : ""}`
    );
  }
  if (!res.ok) {
    throw new Error(`Keepa category HTTP ${res.status}`);
  }

  const fromCategoriesMap = (): string[] => {
    const cats = json.categories;
    if (!cats || typeof cats !== "object") {
      return [];
    }
    const node =
      cats[clean] ??
      cats[String(Number(clean))] ??
      Object.values(cats).find(
        (c) => c?.catId != null && String(c.catId) === clean
      );
    return normalizeChildIds(node?.children);
  };

  const fromTopChildren = normalizeChildIds(json.children);
  if (fromTopChildren.length > 0) {
    return fromTopChildren;
  }

  const fromCategoryObj = normalizeChildIds(json.category?.children);
  if (fromCategoryObj.length > 0) {
    return fromCategoryObj;
  }

  return fromCategoriesMap();
}

/**
 * For each root id: if it has direct children, use those; otherwise keep the root (leaf).
 * Deduplicates and returns a stable sorted list.
 */
export async function expandRootsToBestsellerCategoryIds(
  apiKey: string,
  domain: number,
  roots: string[],
  onError: (message: string) => void
): Promise<string[]> {
  const out = new Set<string>();

  for (const root of roots) {
    const clean = root.replace(/\D/g, "") || root;
    if (!clean) {
      continue;
    }
    try {
      const children = await fetchDirectChildCategoryIds(
        apiKey,
        domain,
        clean
      );
      if (children.length > 0) {
        for (const c of children) {
          out.add(c);
        }
      } else {
        out.add(clean);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(`Keepa category expand ${clean}: ${msg}`);
      out.add(clean);
    }
  }

  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
