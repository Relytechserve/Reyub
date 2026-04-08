import { describe, expect, it } from "vitest";

import { buildQogitaProductUrl, isValidQogitaUrl } from "@/lib/sourcing/qogita-link";

describe("buildQogitaProductUrl", () => {
  it("uses flags.productLink when it is an absolute qogita.com URL", () => {
    const url = buildQogitaProductUrl({
      qogitaId: "native-123",
      ean: "5012345678901",
      flags: { productLink: "https://www.qogita.com/products/abc" },
    });
    expect(url).toBe("https://www.qogita.com/products/abc");
  });

  it("ignores non-qogita flags.productLink and returns null fallback", () => {
    const url = buildQogitaProductUrl({
      qogitaId: "native-123",
      ean: "5012345678901",
      flags: { productLink: "https://example.com/product/abc" },
    });
    expect(url).toBeNull();
  });

  it("returns null for native ids without an explicit product link", () => {
    const url = buildQogitaProductUrl({
      qogitaId: "qogita-native-id",
      ean: "5012345678901",
      flags: null,
    });
    expect(url).toBeNull();
  });

  it("returns null for excel synthetic rows without explicit product link", () => {
    const url = buildQogitaProductUrl({
      qogitaId: "excel-gtin-5012345678901",
      ean: "5012345678901",
      flags: null,
    });
    expect(url).toBeNull();
  });
});

describe("isValidQogitaUrl", () => {
  it("accepts valid qogita URL and rejects empty/non-qogita URLs", () => {
    expect(isValidQogitaUrl("https://www.qogita.com/search/?q=123")).toBe(true);
    expect(isValidQogitaUrl("")).toBe(false);
    expect(isValidQogitaUrl("https://example.com/search/?q=123")).toBe(false);
    expect(isValidQogitaUrl(null)).toBe(false);
  });
});
