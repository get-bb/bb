export function environmentIdFromSubPath(subPath: string): string | null {
  const [segment] = subPath.split("/");
  if (segment === undefined || segment.length === 0) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function draftKeyFor(environmentId: string): string {
  return `conductor-new-chat:${environmentId}`;
}
