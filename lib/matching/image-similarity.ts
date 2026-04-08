import { and, eq, or } from "drizzle-orm";

import type { getDb } from "@/db";
import { imageSimilarityCache } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

export type ImageSimilarityStatus = "ok" | "missing" | "error";

export type ImageSimilarityResult = {
  status: ImageSimilarityStatus;
  score: number | null;
  error?: string;
  cached: boolean;
  provider: string;
};

export interface ImageSimilarityProvider {
  readonly name: string;
  compare(sourceImageUrl: string, targetImageUrl: string): Promise<ImageSimilarityResult>;
}

export class RemoteEmbeddingImageSimilarityProvider implements ImageSimilarityProvider {
  readonly name = "remote-embedding";

  async compare(sourceImageUrl: string, targetImageUrl: string): Promise<ImageSimilarityResult> {
    const endpoint = process.env.IMAGE_SIMILARITY_ENDPOINT?.trim();
    if (!endpoint) {
      return {
        status: "missing",
        score: null,
        error: "IMAGE_SIMILARITY_ENDPOINT missing",
        cached: false,
        provider: this.name,
      };
    }
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.IMAGE_SIMILARITY_API_KEY
            ? { authorization: `Bearer ${process.env.IMAGE_SIMILARITY_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({ sourceImageUrl, targetImageUrl }),
      });
      const raw = await res.text();
      const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (!res.ok) {
        return {
          status: "error",
          score: null,
          error: `provider_http_${res.status}`,
          cached: false,
          provider: this.name,
        };
      }
      const score =
        typeof data.score === "number"
          ? Math.max(0, Math.min(1, data.score))
          : null;
      if (score == null) {
        return {
          status: "error",
          score: null,
          error: "invalid_provider_payload",
          cached: false,
          provider: this.name,
        };
      }
      return { status: "ok", score, cached: false, provider: this.name };
    } catch (error) {
      return {
        status: "error",
        score: null,
        error: error instanceof Error ? error.message : String(error),
        cached: false,
        provider: this.name,
      };
    }
  }
}

function normalizedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export class ImageSimilarityService {
  constructor(
    private readonly db: Db,
    private readonly provider: ImageSimilarityProvider = new RemoteEmbeddingImageSimilarityProvider()
  ) {}

  async compare(
    sourceImageUrl: string | null | undefined,
    targetImageUrl: string | null | undefined
  ): Promise<ImageSimilarityResult> {
    if (!sourceImageUrl || !targetImageUrl) {
      return {
        status: "missing",
        score: null,
        cached: false,
        provider: this.provider.name,
        error: "missing_image_url",
      };
    }
    const [a, b] = normalizedPair(sourceImageUrl, targetImageUrl);
    const cachedRows = await this.db
      .select()
      .from(imageSimilarityCache)
      .where(
        and(
          eq(imageSimilarityCache.provider, this.provider.name),
          or(
            and(
              eq(imageSimilarityCache.sourceImageUrl, a),
              eq(imageSimilarityCache.targetImageUrl, b)
            ),
            and(
              eq(imageSimilarityCache.sourceImageUrl, b),
              eq(imageSimilarityCache.targetImageUrl, a)
            )
          )
        )
      )
      .limit(1);
    const cached = cachedRows[0];
    if (cached) {
      return {
        status: cached.status,
        score: cached.score ? Number(cached.score) : null,
        error: cached.error ?? undefined,
        cached: true,
        provider: this.provider.name,
      };
    }

    const fresh = await this.provider.compare(a, b);
    await this.db
      .insert(imageSimilarityCache)
      .values({
        provider: this.provider.name,
        sourceImageUrl: a,
        targetImageUrl: b,
        status: fresh.status,
        score: fresh.score == null ? null : String(fresh.score),
        error: fresh.error ?? null,
        lastComputedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          imageSimilarityCache.provider,
          imageSimilarityCache.sourceImageUrl,
          imageSimilarityCache.targetImageUrl,
        ],
        set: {
          status: fresh.status,
          score: fresh.score == null ? null : String(fresh.score),
          error: fresh.error ?? null,
          lastComputedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    return { ...fresh, cached: false };
  }
}
