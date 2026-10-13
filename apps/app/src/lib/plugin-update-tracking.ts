const KEY = "bb.watched-plugin-updates";

function watched(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function isWatchedPluginUpdate(id: string): boolean {
  return watched().includes(id);
}

export function trackPluginUpdate(id: string, active: boolean): void {
  const ids = watched().filter((candidate) => candidate !== id);
  if (active) ids.push(id);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids.slice(-100)));
  } catch {}
}
