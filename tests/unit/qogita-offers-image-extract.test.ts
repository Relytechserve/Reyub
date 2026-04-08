import { describe, expect, it } from "vitest";

import { mapOfferToRow } from "@/lib/qogita/offers";

describe("qogita image extraction", () => {
  it("extracts primary and additional image URLs", () => {
    const mapped = mapOfferToRow({
      id: "q-1",
      title: "Sample Product",
      media: {
        gallery: [
          "https://cdn.example.com/prod-a.jpg",
          "https://cdn.example.com/prod-a-2.png",
        ],
      },
    });
    expect(mapped).not.toBeNull();
    expect(mapped?.primaryImageUrl).toMatch(/^https:\/\/cdn\.example\.com\/prod-a/);
    expect(mapped?.imageUrls).toContain("https://cdn.example.com/prod-a.jpg");
    expect(mapped?.imageUrls).toContain("https://cdn.example.com/prod-a-2.png");
    expect(mapped?.imageUrls.length).toBe(2);
  });
});
