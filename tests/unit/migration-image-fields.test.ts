import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("image similarity migration", () => {
  it("adds image URL fields and cache table", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/migrations/0006_image_similarity_signal.sql"),
      "utf8"
    );
    expect(migration).toContain('ADD COLUMN "primary_image_url"');
    expect(migration).toContain('ADD COLUMN "image_urls"');
    expect(migration).toContain('CREATE TABLE "image_similarity_cache"');
  });
});
