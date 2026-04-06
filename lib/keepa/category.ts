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

function parseChildIdsFromCategoryJson(
  json: CategoryLookupResponse,
  clean: string
): string[] {
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
    let ids = normalizeChildIds(node?.children);
    if (ids.length === 0) {
      const values = Object.values(cats);
      if (values.length === 1) {
        ids = normalizeChildIds(values[0]?.children);
      }
    }
    return ids;
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

async function fetchCategoryJson(
  apiKey: string,
  domain: number,
  categoryId: string,
  includeChildrenFlag: boolean
): Promise<CategoryLookupResponse> {
  const clean = categoryId.replace(/\D/g, "") || categoryId;
  const params = new URLSearchParams({
    key: apiKey,
    domain: String(domain),
    category: clean,
  });
  if (includeChildrenFlag) {
    params.set("children", "1");
  }
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
  return json;
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

  let json = await fetchCategoryJson(apiKey, domain, clean, true);
  let ids = parseChildIdsFromCategoryJson(json, clean);
  if (ids.length === 0) {
    json = await fetchCategoryJson(apiKey, domain, clean, false);
    ids = parseChildIdsFromCategoryJson(json, clean);
  }
  return ids;
}

export type ExpandBestsellerCategoryOptions = {
  /** 1 = direct children of each root only; 2 = also expand each child (more API calls, broader ASIN coverage). */
  maxDepth: 1 | 2;
  maxCategoryFetches: number;
};

/**
 * Resolve browse node IDs for bestseller pulls: expand Amazon category tree from configured roots.
 * Depth 2 helps when the parent has few direct children but richer sub-subcategories.
 */
export async function expandRootsToBestsellerCategoryIds(
  apiKey: string,
  domain: number,
  roots: string[],
  onError: (message: string) => void,
  options?: Partial<ExpandBestsellerCategoryOptions>
): Promise<string[]> {
  const maxDepth = options?.maxDepth ?? 1;
  const maxFetches = options?.maxCategoryFetches ?? 80;
  let fetches = 0;

  const childrenOf = async (id: string): Promise<string[]> => {
    if (fetches >= maxFetches) {
      return [];
    }
    fetches += 1;
    try {
      return await fetchDirectChildCategoryIds(apiKey, domain, id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(`Keepa category expand ${id}: ${msg}`);
      return [];
    }
  };

  const out = new Set<string>();

  for (const root of roots) {
    const clean = root.replace(/\D/g, "") || root;
    if (!clean) {
      continue;
    }

    const level1 = await childrenOf(clean);
    if (level1.length === 0) {
      out.add(clean);
      continue;
    }

    if (maxDepth <= 1) {
      for (const c of level1) {
        out.add(c);
      }
      continue;
    }

    for (const child of level1) {
      const level2 = await childrenOf(child);
      if (level2.length === 0) {
        out.add(child);
      } else {
        for (const c of level2) {
          out.add(c);
        }
      }
    }
  }

  return [...out].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
}
