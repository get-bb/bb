/**
 * Compare two strings by Unicode codepoint, matching the server's SQLite binary
 * `asc()` collation and the fractional-index key generator
 * (`createOrderKeyBetween`, which compares with `<`/`>=`). Use this — not
 * `String.localeCompare` — whenever client ordering of an order key (`sortKey`,
 * `pinSortKey`) or an `id` must agree with the server, since `localeCompare`
 * folds case and reorders letters vs. digits.
 */
export function compareCodepoint(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
