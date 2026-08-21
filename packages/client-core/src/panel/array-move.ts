/**
 * Returns a copy of `array` with the item at `from` moved to `to`. Mirrors
 * `arrayMove` from `@dnd-kit/sortable`, which the web sidebar drag layer uses;
 * kept local so the shared tab-state reducers do not depend on a DOM drag
 * library.
 */
export function arrayMove<T>(
  array: readonly T[],
  from: number,
  to: number,
): T[] {
  const result = [...array];
  const [moved] = result.splice(from, 1);
  if (moved === undefined) {
    return result;
  }
  result.splice(to < 0 ? result.length + to : to, 0, moved);
  return result;
}
