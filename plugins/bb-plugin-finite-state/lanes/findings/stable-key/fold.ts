/**
 * Matches the frozen finding-key codec's fixed-locale Unicode folding.
 * This is comparison normalization only; authored values remain unchanged.
 */
export function foldFindingComponent(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

/** Cache rows historically represent a missing group as either NULL or empty. */
export function foldFindingGroup(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null;
  return foldFindingComponent(value);
}

/** Version matching is deliberately exact apart from the codec's boundary normalization. */
export function normalizeFindingVersion(value: string | null): string | null {
  if (value === null) return null;
  return value.normalize("NFC").trim();
}

/** Purls are opaque canonical identities: normalize framing without case-folding or parsing. */
export function normalizeFindingPurl(value: string | null): string | null {
  if (value === null) return null;
  return value.normalize("NFC").trim();
}
