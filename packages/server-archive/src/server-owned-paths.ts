import { pluginIdSchema } from "@bb/domain";
import { isSafeRelativePath } from "./relative-path.js";

export const SERVER_OWNED_TOP_LEVEL_FILES: readonly string[] = [
  "bb.db",
  "config.json",
  "env.json",
  "auth-secret",
  "machine-environment-key",
  "AGENTS.md",
  "telemetry-id",
];
export const SERVER_OWNED_TOP_LEVEL_DIRECTORIES: readonly string[] = [
  "attachments",
  "skills",
  "theme",
];
export const PLUGINS_DIR_NAME = "plugins";

const TOP_LEVEL_FILE_NAMES: ReadonlySet<string> = new Set(
  SERVER_OWNED_TOP_LEVEL_FILES,
);
const TOP_LEVEL_DIRECTORY_NAMES: ReadonlySet<string> = new Set(
  SERVER_OWNED_TOP_LEVEL_DIRECTORIES,
);
const SERVER_OWNED_PLUGIN_TREES: ReadonlySet<string> = new Set([
  "npm",
  "cache",
  "snapshots",
]);
const HOST_OWNED_PLUGIN_CHILDREN: ReadonlySet<string> = new Set([
  "host-data",
  "bridge-data",
  "logs",
  "data.db-wal",
  "data.db-shm",
  "data.db-journal",
]);
const TOOLCHAIN_PLUGIN_DIR_PREFIX = "toolchain-";
const SERVER_DATABASE_PATH = "bb.db";
const PLUGIN_DATABASE_FILE_NAME = "data.db";

export interface ServerOwnedRoot {
  path: string;
  kind: "file" | "tree";
}

export function isServerOwnedPluginDirectoryName(name: string): boolean {
  return (
    !SERVER_OWNED_PLUGIN_TREES.has(name) &&
    !name.startsWith(TOOLCHAIN_PLUGIN_DIR_PREFIX) &&
    pluginIdSchema.safeParse(name).success
  );
}

export function findServerOwnedRoot(
  relativePath: string,
): ServerOwnedRoot | null {
  const segments = relativePath.split("/");
  const first = segments[0] ?? "";
  if (TOP_LEVEL_FILE_NAMES.has(first)) {
    return { path: first, kind: "file" };
  }
  if (TOP_LEVEL_DIRECTORY_NAMES.has(first)) {
    return { path: first, kind: "tree" };
  }
  if (first !== PLUGINS_DIR_NAME || segments.length < 2) {
    return null;
  }
  const pluginDirectory = segments[1] ?? "";
  if (SERVER_OWNED_PLUGIN_TREES.has(pluginDirectory)) {
    return { path: segments.slice(0, 2).join("/"), kind: "tree" };
  }
  const pluginChild = segments[2] ?? "";
  if (
    segments.length < 3 ||
    !isServerOwnedPluginDirectoryName(pluginDirectory) ||
    HOST_OWNED_PLUGIN_CHILDREN.has(pluginChild)
  ) {
    return null;
  }
  return { path: segments.slice(0, 3).join("/"), kind: "tree" };
}

export function isServerOwnedPath(relativePath: string): boolean {
  if (!isSafeRelativePath(relativePath)) {
    return false;
  }
  const root = findServerOwnedRoot(relativePath);
  return root !== null && (root.kind === "tree" || root.path === relativePath);
}

export function isServerSqliteDatabasePath(relativePath: string): boolean {
  if (relativePath === SERVER_DATABASE_PATH) {
    return true;
  }
  const segments = relativePath.split("/");
  return (
    segments.length === 3 &&
    segments[0] === PLUGINS_DIR_NAME &&
    segments[2] === PLUGIN_DATABASE_FILE_NAME &&
    isServerOwnedPluginDirectoryName(segments[1] ?? "")
  );
}
