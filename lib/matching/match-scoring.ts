import { normalizeTitleForMatch, titleTokens, tokenSetJaccard } from "@/lib/matching/title-similarity";

type MatchConfidence = "high" | "medium";
type MatchDecision = MatchConfidence | "reject_candidate";

export type ScoringWeights = {
  ean: number;
  title: number;
  brand: number;
  sizePack: number;
  image: number;
};

export type ScoringThresholds = {
  high: number;
  medium: number;
  strongConflictCap: number;
};

export type MatchSignals = {
  eanSignal: number;
  titleSignal: number;
  brandSignal: number;
  sizePackSignal: number;
  imageSignal: number;
  coreNameSignal: number;
};

export type MatchPolicyResult = {
  decision: MatchDecision;
  confidence: MatchConfidence | null;
  weightedScore: number;
  signals: MatchSignals;
  reasonTags: string[];
};

export type CandidateInput = {
  amazonTitle: string;
  qogitaTitle: string;
  qogitaBrand: string | null;
  eanMatch: boolean;
  fromEanStage: boolean;
  qogitaUnitsPerPack: number | null;
  qogitaPackDescription: string | null;
  imageSignal?: number | null;
};

const DEFAULT_WEIGHTS: ScoringWeights = {
  ean: 0.4,
  title: 0.25,
  brand: 0.2,
  sizePack: 0.1,
  image: 0.05,
};

const DEFAULT_THRESHOLDS: ScoringThresholds = {
  high: 0.78,
  medium: 0.52,
  strongConflictCap: 0.69,
};

const CORE_TOKEN_STOP = new Set([
  "parfum",
  "perfume",
  "eau",
  "spray",
  "fragrance",
  "unisex",
  "women",
  "woman",
  "men",
  "man",
  "pack",
  "piece",
  "pieces",
]);

function clamp01(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name] ?? "");
  return Number.isFinite(v) ? v : fallback;
}

export function matchScoringWeightsFromEnv(): ScoringWeights {
  const raw = {
    ean: envNum("MATCH_SCORE_WEIGHT_EAN", DEFAULT_WEIGHTS.ean),
    title: envNum("MATCH_SCORE_WEIGHT_TITLE", DEFAULT_WEIGHTS.title),
    brand: envNum("MATCH_SCORE_WEIGHT_BRAND", DEFAULT_WEIGHTS.brand),
    sizePack: envNum("MATCH_SCORE_WEIGHT_SIZE_PACK", DEFAULT_WEIGHTS.sizePack),
    image: envNum("MATCH_SCORE_WEIGHT_IMAGE", DEFAULT_WEIGHTS.image),
  };
  const total = raw.ean + raw.title + raw.brand + raw.sizePack + raw.image;
  if (!Number.isFinite(total) || total <= 0) {
    return DEFAULT_WEIGHTS;
  }
  return {
    ean: raw.ean / total,
    title: raw.title / total,
    brand: raw.brand / total,
    sizePack: raw.sizePack / total,
    image: raw.image / total,
  };
}

export function matchScoringThresholdsFromEnv(): ScoringThresholds {
  const high = clamp01(envNum("MATCH_SCORE_THRESHOLD_HIGH", DEFAULT_THRESHOLDS.high));
  const medium = clamp01(envNum("MATCH_SCORE_THRESHOLD_MEDIUM", DEFAULT_THRESHOLDS.medium));
  const strongConflictCap = clamp01(
    envNum("MATCH_SCORE_STRONG_CONFLICT_CAP", DEFAULT_THRESHOLDS.strongConflictCap)
  );
  return {
    high: Math.max(high, medium),
    medium: Math.min(medium, high),
    strongConflictCap,
  };
}

function parseMeasureTokens(input: string): {
  volumeMl: number | null;
  massG: number | null;
  packCount: number | null;
} {
  const n = normalizeTitleForMatch(input);
  let volumeMl: number | null = null;
  let massG: number | null = null;
  let packCount: number | null = null;

  const addVolume = (ml: number) => {
    if (!Number.isFinite(ml) || ml <= 0) {
      return;
    }
    volumeMl = volumeMl === null ? ml : Math.max(volumeMl, ml);
  };
  const addMass = (g: number) => {
    if (!Number.isFinite(g) || g <= 0) {
      return;
    }
    massG = massG === null ? g : Math.max(massG, g);
  };
  const addPack = (c: number) => {
    if (!Number.isFinite(c) || c <= 0) {
      return;
    }
    packCount = packCount === null ? c : Math.max(packCount, c);
  };

  for (const m of n.matchAll(/(\d+(?:\.\d+)?)\s?(ml|l|oz|floz|g|kg)\b/g)) {
    const value = Number(m[1]);
    const unit = m[2];
    if (!Number.isFinite(value)) {
      continue;
    }
    if (unit === "ml") {
      addVolume(value);
    } else if (unit === "l") {
      addVolume(value * 1000);
    } else if (unit === "oz" || unit === "floz") {
      addVolume(value * 29.5735);
    } else if (unit === "g") {
      addMass(value);
    } else if (unit === "kg") {
      addMass(value * 1000);
    }
  }

  for (const m of n.matchAll(/\b(\d+)\s?(pack|pcs|pc|count|ct|x)\b/g)) {
    addPack(Number(m[1]));
  }

  return { volumeMl, massG, packCount };
}

function ratioSimilarity(a: number | null, b: number | null): number {
  if (a === null || b === null || a <= 0 || b <= 0) {
    return 0.5;
  }
  const max = Math.max(a, b);
  const min = Math.min(a, b);
  return clamp01(min / max);
}

function packSimilarity(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return 0.5;
  }
  return a === b ? 1 : 0;
}

function computeTitleSignal(amazonTitle: string, qogitaTitle: string): number {
  const a = titleTokens(normalizeTitleForMatch(amazonTitle), 3);
  const b = titleTokens(normalizeTitleForMatch(qogitaTitle), 3);
  return clamp01(tokenSetJaccard(a, b));
}

function computeBrandSignal(
  amazonTitle: string,
  qogitaTitle: string,
  qogitaBrand: string | null
): number {
  if (!qogitaBrand?.trim()) {
    return 0.5;
  }
  const brandNorm = normalizeTitleForMatch(qogitaBrand).trim();
  if (!brandNorm) {
    return 0.5;
  }
  const amazonNorm = normalizeTitleForMatch(amazonTitle);
  const qogitaNorm = normalizeTitleForMatch(qogitaTitle);
  if (amazonNorm.includes(brandNorm) && qogitaNorm.includes(brandNorm)) {
    return 1;
  }
  const brandTokens = titleTokens(brandNorm, 2);
  const amazonTokens = titleTokens(amazonNorm, 2);
  const overlap = tokenSetJaccard(brandTokens, amazonTokens);
  return overlap >= 0.5 ? 0.85 : 0;
}

function computeSizePackSignal(input: CandidateInput): number {
  const amazonParsed = parseMeasureTokens(input.amazonTitle);
  const qogitaParsed = parseMeasureTokens(
    `${input.qogitaTitle} ${input.qogitaPackDescription ?? ""}`
  );
  const qPack = input.qogitaUnitsPerPack ?? qogitaParsed.packCount;
  const sizeVolume = ratioSimilarity(amazonParsed.volumeMl, qogitaParsed.volumeMl);
  const sizeMass = ratioSimilarity(amazonParsed.massG, qogitaParsed.massG);
  const sizeSignal = Math.max(sizeVolume, sizeMass);
  const packSignal = packSimilarity(amazonParsed.packCount, qPack);
  return clamp01(sizeSignal * 0.7 + packSignal * 0.3);
}

function computeCoreNameSignal(
  amazonTitle: string,
  qogitaTitle: string,
  qogitaBrand: string | null
): number {
  const a = titleTokens(normalizeTitleForMatch(amazonTitle), 4);
  const q = titleTokens(normalizeTitleForMatch(qogitaTitle), 4);
  const brandTokens = qogitaBrand
    ? titleTokens(normalizeTitleForMatch(qogitaBrand), 3)
    : new Set<string>();
  const toCore = (src: Set<string>): Set<string> =>
    new Set(
      [...src].filter(
        (t) =>
          !CORE_TOKEN_STOP.has(t) &&
          !brandTokens.has(t) &&
          !/\d/.test(t)
      )
    );
  const aCore = toCore(a);
  const qCore = toCore(q);
  if (aCore.size === 0 || qCore.size === 0) {
    return 0.5;
  }
  for (const t of aCore) {
    if (qCore.has(t)) {
      return 1;
    }
  }
  return 0;
}

export function evaluateMatchCandidate(
  input: CandidateInput,
  weights = matchScoringWeightsFromEnv(),
  thresholds = matchScoringThresholdsFromEnv()
): MatchPolicyResult {
  const signals: MatchSignals = {
    eanSignal: input.eanMatch ? 1 : 0,
    titleSignal: computeTitleSignal(input.amazonTitle, input.qogitaTitle),
    brandSignal: computeBrandSignal(input.amazonTitle, input.qogitaTitle, input.qogitaBrand),
    sizePackSignal: computeSizePackSignal(input),
    imageSignal:
      input.imageSignal == null ? 0.5 : clamp01(input.imageSignal),
    coreNameSignal: computeCoreNameSignal(
      input.amazonTitle,
      input.qogitaTitle,
      input.qogitaBrand
    ),
  };

  const weightedScore = clamp01(
    signals.eanSignal * weights.ean +
      signals.titleSignal * weights.title +
      signals.brandSignal * weights.brand +
      signals.sizePackSignal * weights.sizePack +
      signals.imageSignal * weights.image
  );

  const reasonTags = [
    input.fromEanStage ? "candidate_stage:ean" : "candidate_stage:fuzzy",
    `sig_ean:${signals.eanSignal.toFixed(3)}`,
    `sig_title:${signals.titleSignal.toFixed(3)}`,
    `sig_brand:${signals.brandSignal.toFixed(3)}`,
    `sig_size_pack:${signals.sizePackSignal.toFixed(3)}`,
    `sig_image:${signals.imageSignal.toFixed(3)}`,
    `sig_core_name:${signals.coreNameSignal.toFixed(3)}`,
    `score_weighted:${weightedScore.toFixed(3)}`,
  ];

  const strongConflict = signals.titleSignal < 0.2 || signals.brandSignal < 0.2;
  const severeSemanticConflict = signals.titleSignal < 0.2 && signals.brandSignal < 0.2;
  if (input.eanMatch && strongConflict) {
    reasonTags.push("conflict_ean_vs_semantics");
  }
  if (signals.sizePackSignal < 0.4) {
    reasonTags.push("conflict_size_pack");
  }
  if (signals.imageSignal < 0.2) {
    reasonTags.push("conflict_image");
  }
  if (signals.coreNameSignal < 0.5) {
    reasonTags.push("conflict_core_name");
  }

  if (input.eanMatch && signals.coreNameSignal < 0.5) {
    reasonTags.push("reject_candidate");
    return {
      decision: "reject_candidate",
      confidence: null,
      weightedScore,
      signals,
      reasonTags,
    };
  }

  if (input.eanMatch && severeSemanticConflict) {
    reasonTags.push("reject_candidate");
    return {
      decision: "reject_candidate",
      confidence: null,
      weightedScore,
      signals,
      reasonTags,
    };
  }

  if (input.eanMatch && strongConflict && weightedScore <= thresholds.strongConflictCap) {
    reasonTags.push("reject_candidate");
    return {
      decision: "reject_candidate",
      confidence: null,
      weightedScore,
      signals,
      reasonTags,
    };
  }

  if (
    weightedScore >= thresholds.high &&
    !strongConflict &&
    signals.sizePackSignal >= 0.45 &&
    signals.imageSignal >= 0.2
  ) {
    reasonTags.push("confidence_high");
    return { decision: "high", confidence: "high", weightedScore, signals, reasonTags };
  }
  if (weightedScore >= thresholds.medium) {
    reasonTags.push("confidence_medium");
    return { decision: "medium", confidence: "medium", weightedScore, signals, reasonTags };
  }
  reasonTags.push("reject_candidate");
  return {
    decision: "reject_candidate",
    confidence: null,
    weightedScore,
    signals,
    reasonTags,
  };
}
