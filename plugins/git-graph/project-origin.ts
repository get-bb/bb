const STORAGE_KEY = "bb-plugin-git-graph:last-project";
const PROJECT_ROUTE_PATTERN = /^\/projects\/([^/]+?)(?:\/|$)/u;

export function projectFromPathname(pathname: string): string | null {
  const match = PROJECT_ROUTE_PATTERN.exec(pathname);
  return match === null ? null : decodeURIComponent(match[1]!);
}

export function readLastProjectRoute(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastProjectRoute(projectId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, projectId);
  } catch {}
}

export function trackLastProjectRoute(
  onProject: (projectId: string) => void,
  intervalMs = 1_000,
): () => void {
  let lastSeen: string | null = null;
  const track = () => {
    const projectId = projectFromPathname(window.location.pathname);
    if (projectId !== null && projectId !== lastSeen) {
      lastSeen = projectId;
      onProject(projectId);
    }
  };
  track();
  const timer = window.setInterval(track, intervalMs);
  return () => {
    window.clearInterval(timer);
  };
}
