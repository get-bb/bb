import path from "node:path";

/** Where notes live unless the plugin's `rootDirectory` setting says otherwise. */
export const DEFAULT_NOTES_DIRECTORY = "~/Notes";

export function expandHomePath(rawPath: string, homeDirectory: string): string {
  if (rawPath === "~") return homeDirectory;
  if (rawPath.startsWith("~/")) {
    return path.join(homeDirectory, rawPath.slice(2));
  }
  return rawPath;
}

/**
 * Turns the configured `rootDirectory` into an absolute path.
 *
 * A relative path is refused rather than resolved: the setting is read by the
 * server, whose working directory is not something the user can see, so
 * "notes" would silently mean a different folder than they expect.
 */
export function resolveNotesRoot(args: {
  rawPath: string;
  homeDirectory: string;
}): string {
  const expanded = expandHomePath(args.rawPath.trim(), args.homeDirectory);
  if (expanded.length === 0) {
    throw new Error("A notes folder path is required.");
  }
  if (!path.isAbsolute(expanded)) {
    throw new Error(
      `The notes folder must be an absolute path or start with "~/", received "${args.rawPath}".`,
    );
  }
  const normalized = path.normalize(expanded);
  return normalized.length > 1 && normalized.endsWith(path.sep)
    ? normalized.slice(0, -1)
    : normalized;
}

/**
 * Turns a panel-supplied relative path into an absolute one, refusing
 * anything that leaves the notes root.
 *
 * Every path in an RPC arrives from the browser, so `..` or an absolute path
 * must not be able to reach the rest of the disk. The check is on the
 * resolved string, which collapses `..` first, and the prefix comparison
 * includes the separator so `/Notes-other` cannot pass as a child of
 * `/Notes`.
 */
export function resolveWithinRoot(root: string, relativePath: string): string {
  const normalizedRoot = path.resolve(root);
  if (path.isAbsolute(relativePath)) {
    throw new Error("Note paths must be relative to the notes folder");
  }
  const resolved = path.resolve(normalizedRoot, relativePath);
  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(normalizedRoot + path.sep)
  ) {
    throw new Error("That path is outside the notes folder");
  }
  return resolved;
}

/** Inverse of `resolveWithinRoot`, for reporting a path back to the panel. */
export function relativeToRoot(root: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(root), absolutePath);
  return relative.split(path.sep).join("/");
}
