import { describe, expect, it, vi } from "vitest";

import { RemoteEmbeddingImageSimilarityProvider } from "@/lib/matching/image-similarity";

describe("remote image similarity provider", () => {
  it("handles missing endpoint without throwing", async () => {
    const old = process.env.IMAGE_SIMILARITY_ENDPOINT;
    delete process.env.IMAGE_SIMILARITY_ENDPOINT;
    const provider = new RemoteEmbeddingImageSimilarityProvider();
    const res = await provider.compare("https://a/x.jpg", "https://b/y.jpg");
    expect(res.status).toBe("missing");
    process.env.IMAGE_SIMILARITY_ENDPOINT = old;
  });

  it("parses score from provider response", async () => {
    process.env.IMAGE_SIMILARITY_ENDPOINT = "https://img.example/sim";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ score: 0.88 }),
      status: 200,
    });
    vi.stubGlobal("fetch", mockFetch);
    const provider = new RemoteEmbeddingImageSimilarityProvider();
    const res = await provider.compare("https://a/x.jpg", "https://b/y.jpg");
    expect(res.status).toBe("ok");
    expect(res.score).toBe(0.88);
    vi.unstubAllGlobals();
  });
});
