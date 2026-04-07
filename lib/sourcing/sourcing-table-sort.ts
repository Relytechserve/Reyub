/** Column identifiers for header sorting (maps to `sort` query values). */
export type SourcingSortColumn =
  | "margin"
  | "mov_margin"
  | "potential"
  | "capital"
  | "profit_unit"
  | "profit_line";

const COLUMN_PRIMARY_SORT: Record<SourcingSortColumn, string> = {
  margin: "margin_desc",
  mov_margin: "mov_margin_desc",
  potential: "potential_desc",
  capital: "capital_asc",
  profit_unit: "profit_unit_desc",
  profit_line: "profit_line_desc",
};

const COLUMN_ALTERNATE_SORT: Record<SourcingSortColumn, string> = {
  margin: "margin_asc",
  mov_margin: "mov_margin_asc",
  potential: "potential_asc",
  capital: "capital_desc",
  profit_unit: "profit_unit_asc",
  profit_line: "profit_line_asc",
};

/** Toggle asc/desc when clicking the same column; otherwise use that column’s default primary order. */
export function nextSortKeyForColumn(
  currentSort: string,
  column: SourcingSortColumn
): string {
  const primary = COLUMN_PRIMARY_SORT[column];
  const alt = COLUMN_ALTERNATE_SORT[column];
  if (currentSort === primary) {
    return alt;
  }
  if (currentSort === alt) {
    return primary;
  }
  return primary;
}

export function sortKeysForColumn(column: SourcingSortColumn): readonly [string, string] {
  return [COLUMN_PRIMARY_SORT[column], COLUMN_ALTERNATE_SORT[column]];
}

export function isSortActiveForColumn(
  sortBy: string,
  column: SourcingSortColumn
): boolean {
  const [a, b] = sortKeysForColumn(column);
  return sortBy === a || sortBy === b;
}

export function sortDirectionGlyph(sortBy: string, column: SourcingSortColumn): string {
  if (!isSortActiveForColumn(sortBy, column)) {
    return "↕";
  }
  return sortBy.endsWith("_asc") ? "▲" : "▼";
}
