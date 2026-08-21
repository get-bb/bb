/**
 * Path helpers for the remote path browser (mirrors the pure parts of
 * apps/app/src/components/dialogs/RemotePathBrowser.tsx). The host's
 * separator is inferred from the path string because the client cannot know
 * a remote host's platform.
 */

interface PathCrumb {
  label: string;
  path: string;
}

/** Splits an absolute directory into navigable ancestor crumbs (POSIX or Windows). */
export function toBreadcrumb(directory: string): PathCrumb[] {
  const isWindows = /^[A-Za-z]:/.test(directory);
  if (!isWindows) {
    const crumbs: PathCrumb[] = [{ label: "/", path: "/" }];
    let accumulated = "";
    for (const segment of directory.split("/").filter(Boolean)) {
      accumulated = `${accumulated}/${segment}`;
      crumbs.push({ label: segment, path: accumulated });
    }
    return crumbs;
  }
  const segments = directory.replace(/\//g, "\\").split("\\").filter(Boolean);
  const drive = segments[0] ?? "";
  const crumbs: PathCrumb[] = [{ label: drive, path: `${drive}\\` }];
  let accumulated = drive;
  for (const segment of segments.slice(1)) {
    accumulated = `${accumulated}\\${segment}`;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

/** Appends a child name using the separator inferred from `directory`. */
export function joinHostPath(directory: string, name: string): string {
  if (/^[A-Za-z]:/.test(directory)) {
    return `${directory.replace(/[\\/]+$/, "")}\\${name}`;
  }
  return `${directory.replace(/\/+$/, "")}/${name}`;
}

/** Rejects names that would silently create somewhere other than here. */
export function getFolderNameValidationMessage(name: string): string | null {
  if (!name) return "Enter a folder name.";
  if (name === "." || name === "..") return "Enter a folder name.";
  if (/[\\/]/.test(name)) return "Folder names can't contain slashes.";
  return null;
}
