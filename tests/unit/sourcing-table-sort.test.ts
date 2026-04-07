import { describe, expect, it } from "vitest";

import {
  nextSortKeyForColumn,
  sortDirectionGlyph,
} from "@/lib/sourcing/sourcing-table-sort";

describe("nextSortKeyForColumn", () => {
  it("toggles margin desc/asc", () => {
    expect(nextSortKeyForColumn("profit_line_desc", "margin")).toBe("margin_desc");
    expect(nextSortKeyForColumn("margin_desc", "margin")).toBe("margin_asc");
    expect(nextSortKeyForColumn("margin_asc", "margin")).toBe("margin_desc");
  });

  it("uses capital_asc as primary when switching from another column", () => {
    expect(nextSortKeyForColumn("margin_desc", "capital")).toBe("capital_asc");
    expect(nextSortKeyForColumn("capital_asc", "capital")).toBe("capital_desc");
    expect(nextSortKeyForColumn("capital_desc", "capital")).toBe("capital_asc");
  });
});

describe("sortDirectionGlyph", () => {
  it("shows arrows only for active column", () => {
    expect(sortDirectionGlyph("margin_desc", "margin")).toBe("▼");
    expect(sortDirectionGlyph("margin_asc", "margin")).toBe("▲");
    expect(sortDirectionGlyph("margin_desc", "profit_line")).toBe("↕");
  });
});
