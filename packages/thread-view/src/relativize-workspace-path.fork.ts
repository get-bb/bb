// bb-fork(windows): providers report forward-slash paths while the workspace
// root arrives with backslashes, so the upstream prefix check misses and the
// path stays absolute.
export function relativizeWorkspacePathFork(
  path: string,
  workspaceRoot: string | null,
): string | null {
  if (workspaceRoot === null) return null;
  const windowsStyle =
    /^[a-zA-Z]:[\\/]/u.test(workspaceRoot) || workspaceRoot.includes("\\");
  const root = (
    windowsStyle ? workspaceRoot.replaceAll("\\", "/") : workspaceRoot
  ).replace(/\/+$/u, "");
  if (root.length === 0) return null;
  const candidate = windowsStyle ? path.replaceAll("\\", "/") : path;
  const prefix = `${root}/`;
  const matches = windowsStyle
    ? candidate.toLowerCase().startsWith(prefix.toLowerCase())
    : candidate.startsWith(prefix);
  return matches ? candidate.slice(prefix.length) : null;
}
