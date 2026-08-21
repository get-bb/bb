/** The typeahead list's height cap when it has all the room it wants. */
export const TYPEAHEAD_MAX_HEIGHT = 280;
/** Gap between the floating list and the top edge of the composer card. */
export const TYPEAHEAD_GAP = 6;
/** Room kept between the list and the top of its overlay bounds. */
export const TYPEAHEAD_TOP_MARGIN = 8;
/**
 * Never shrink the list below one row. Under this height the list is not
 * operable; above it, scrolling reaches every row as long as the list stays
 * inside its bounds. With less than a row (plus margins) of room above the
 * card — a landscape phone with a tall draft — the list overlaps the bounds
 * top by the difference.
 */
export const TYPEAHEAD_MIN_HEIGHT = 44;

/**
 * The height cap for the typeahead list that floats above the composer
 * card. `spaceAbove` is the distance from the top of the overlay bounds
 * (the screen content under the native header) to the top of the card;
 * `null` while unmeasured (no bounds provider, or before the first layout),
 * which keeps the fixed cap.
 */
export function resolveTypeaheadMaxHeight(spaceAbove: number | null): number {
  if (spaceAbove === null || !Number.isFinite(spaceAbove)) {
    return TYPEAHEAD_MAX_HEIGHT;
  }
  const available = spaceAbove - TYPEAHEAD_GAP - TYPEAHEAD_TOP_MARGIN;
  return Math.max(
    TYPEAHEAD_MIN_HEIGHT,
    Math.min(TYPEAHEAD_MAX_HEIGHT, available),
  );
}
