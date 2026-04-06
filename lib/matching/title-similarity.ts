const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "you",
  "are",
  "was",
  "has",
  "have",
  "new",
  "pack",
  "pcs",
  "x",
  "ml",
  "g",
  "kg",
  "oz",
  "fl",
  "per",
  "set",
  "size",
]);

export function normalizeTitleForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(
  normalized: string,
  minLen = 4
): Set<string> {
  const set = new Set<string>();
  for (const w of normalized.split(" ")) {
    if (w.length >= minLen && !STOP.has(w)) {
      set.add(w);
    }
  }
  return set;
}

export function tokenSetJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) {
      inter += 1;
    }
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export type QogitaTitleRow = {
  id: string;
  title: string;
  brand: string | null;
};

export type PreparedQogitaRow = QogitaTitleRow & {
  tokens: Set<string>;
};

export function prepareQogitaRow(row: QogitaTitleRow): PreparedQogitaRow {
  const base = normalizeTitleForMatch(row.title);
  const tokens = titleTokens(base);
  const b = row.brand?.trim();
  if (b) {
    const bn = normalizeTitleForMatch(b);
    for (const w of bn.split(" ")) {
      if (w.length >= 3) {
        tokens.add(w);
      }
    }
  }
  return { ...row, tokens };
}

/** Require brand substring or token overlap when brand is present. */
export function passesBrandGate(
  amazonNorm: string,
  brand: string | null
): boolean {
  if (!brand?.trim()) {
    return true;
  }
  const bn = normalizeTitleForMatch(brand);
  if (bn.length < 2) {
    return true;
  }
  if (amazonNorm.includes(bn)) {
    return true;
  }
  const amazonTokens = titleTokens(amazonNorm, 3);
  for (const w of bn.split(" ")) {
    if (w.length >= 3 && amazonTokens.has(w)) {
      return true;
    }
  }
  return false;
}

export type FuzzyMatchConfig = {
  minJaccard: number;
  minTop2Gap: number;
  minTokenLen: number;
};

const DEFAULT_FUZZY: FuzzyMatchConfig = {
  minJaccard: 0.38,
  minTop2Gap: 0.08,
  minTokenLen: 4,
};

export type FuzzyBestResult = {
  id: string;
  score: number;
  secondScore: number;
};

export function buildTokenIndex(
  prepared: PreparedQogitaRow[],
  minIndexTokenLen: number
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (let i = 0; i < prepared.length; i += 1) {
    for (const t of prepared[i].tokens) {
      if (t.length < minIndexTokenLen) {
        continue;
      }
      let set = map.get(t);
      if (!set) {
        set = new Set();
        map.set(t, set);
      }
      set.add(i);
    }
  }
  return map;
}

export function pickBestFuzzyQogitaMatch(
  amazonTitle: string,
  prepared: PreparedQogitaRow[],
  tokenIndex: Map<string, Set<number>>,
  config: FuzzyMatchConfig = DEFAULT_FUZZY
): FuzzyBestResult | null {
  const amazonNorm = normalizeTitleForMatch(amazonTitle);
  if (amazonNorm.length < 8) {
    return null;
  }
  const amazonTokens = titleTokens(amazonNorm, config.minTokenLen);
  if (amazonTokens.size < 2) {
    return null;
  }

  const candidateIdx = new Set<number>();
  for (const t of amazonTokens) {
    if (t.length < config.minTokenLen) {
      continue;
    }
    const hit = tokenIndex.get(t);
    if (hit) {
      for (const i of hit) {
        candidateIdx.add(i);
      }
    }
  }

  let bestI = -1;
  let bestScore = 0;
  let second = 0;

  for (const i of candidateIdx) {
    const row = prepared[i];
    if (!passesBrandGate(amazonNorm, row.brand)) {
      continue;
    }
    const j = tokenSetJaccard(amazonTokens, row.tokens);
    if (j > bestScore) {
      second = bestScore;
      bestScore = j;
      bestI = i;
    } else if (j > second) {
      second = j;
    }
  }

  if (bestI < 0 || bestScore < config.minJaccard) {
    return null;
  }
  if (second > 0 && bestScore - second < config.minTop2Gap) {
    return null;
  }

  return {
    id: prepared[bestI].id,
    score: bestScore,
    secondScore: second,
  };
}
