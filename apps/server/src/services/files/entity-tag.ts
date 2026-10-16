export function requestMatchesEntityTag(
  ifNoneMatch: string | undefined,
  entityTag: string,
): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  const trimmed = ifNoneMatch.trim();
  if (trimmed === "*") {
    return true;
  }
  const opaque = (tag: string): string => tag.trim().replace(/^W\//u, "");
  return trimmed.split(",").map(opaque).includes(opaque(entityTag));
}
