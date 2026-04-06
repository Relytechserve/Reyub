import { describe, expect, it } from "vitest";

import {
  buildGtinToQogitaIdMap,
} from "@/lib/matching/amazon-qogita-sync";
import {
  collectGtinKeysFromBarcode,
  expandGtinLookupKeys,
} from "@/lib/matching/gtin";
import {
  pickBestFuzzyQogitaMatch,
  prepareQogitaRow,
  tokenSetJaccard,
  buildTokenIndex,
} from "@/lib/matching/title-similarity";

describe("gtin variants", () => {
  it("expands 12-digit UPC to 13 with leading zero", () => {
    const keys = expandGtinLookupKeys("012345678905");
    expect(keys).toContain("012345678905");
    expect(keys).toContain("0012345678905");
  });

  it("collectGtinKeysFromBarcode includes variants", () => {
    const keys = collectGtinKeysFromBarcode("123456789012");
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys).toContain("123456789012");
    expect(keys).toContain("0123456789012");
  });
});

describe("buildGtinToQogitaIdMap", () => {
  it("picks lower buy price when two API rows share a GTIN key", () => {
    const m = buildGtinToQogitaIdMap([
      {
        id: "a",
        qogitaId: "api-offer-a",
        ean: "1234567890123",
        buyUnitPrice: "10.00",
      },
      {
        id: "b",
        qogitaId: "api-offer-b",
        ean: "1234567890123",
        buyUnitPrice: "8.50",
      },
    ]);
    expect(m.get("1234567890123")).toBe("b");
  });

  it("prefers live API row over Excel catalog row even if Excel is cheaper", () => {
    const m = buildGtinToQogitaIdMap([
      {
        id: "excel-row",
        qogitaId: "excel-gtin-1234567890123",
        ean: "1234567890123",
        buyUnitPrice: "1.00",
      },
      {
        id: "api-row",
        qogitaId: "live-qid-xyz",
        ean: "1234567890123",
        buyUnitPrice: "99.00",
      },
    ]);
    expect(m.get("1234567890123")).toBe("api-row");
  });

  it("uses Excel row when no API row exists for that GTIN", () => {
    const m = buildGtinToQogitaIdMap([
      {
        id: "excel-only",
        qogitaId: "excel-gtin-1234567890123",
        ean: "1234567890123",
        buyUnitPrice: "5.00",
      },
    ]);
    expect(m.get("1234567890123")).toBe("excel-only");
  });

  it("picks cheaper Excel row when multiple Excel-sourced rows share a GTIN", () => {
    const m = buildGtinToQogitaIdMap([
      {
        id: "x1",
        qogitaId: "excel-gtin-1234567890123",
        ean: "1234567890123",
        buyUnitPrice: "9.00",
      },
      {
        id: "x2",
        qogitaId: "excel-gtin-legacy-dup",
        ean: "1234567890123",
        buyUnitPrice: "3.00",
      },
    ]);
    expect(m.get("1234567890123")).toBe("x2");
  });
});

describe("title similarity", () => {
  it("tokenSetJaccard is 1 for identical token sets", () => {
    const a = new Set(["hello", "world", "product"]);
    expect(tokenSetJaccard(a, a)).toBe(1);
  });

  it("pickBestFuzzyQogitaMatch finds obvious title twin", () => {
    const prepared = [
      prepareQogitaRow({
        id: "q1",
        title: "Acme Vitamin C 1000mg Tablets 60 Count",
        brand: "Acme",
      }),
      prepareQogitaRow({
        id: "q2",
        title: "Totally Different Hair Oil 200ml",
        brand: "Other",
      }),
    ];
    const idx = buildTokenIndex(prepared, 4);
    const hit = pickBestFuzzyQogitaMatch(
      "Acme Vitamin C 1000mg Tablets — 60 pack UK",
      prepared,
      idx,
      { minJaccard: 0.35, minTop2Gap: 0.05, minTokenLen: 4 }
    );
    expect(hit?.id).toBe("q1");
  });
});
