import { z } from "zod";

/**
 * A plugin id as {@link derivePluginId} produces it: lowercase alphanumerics
 * and dashes, starting with an alphanumeric. Anywhere a plugin id crosses a
 * boundary (a queued row's wait holder) this is what makes it a value the
 * routes and CLI can address back.
 */
export const GIT_PLUGIN_ID = "bb--git";
export const CORE_PLUGIN_ID = "bb--core";

export const pluginIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);

export const CORE_PLUGIN_DIRECTORIES = {
  npmPackages: "npm",
  cache: "cache",
  runtime: "runtime",
  stateSnapshots: "snapshots",
} as const;

const coreOwnedPluginDirectoryNames: ReadonlySet<string> = new Set(
  Object.values(CORE_PLUGIN_DIRECTORIES),
);

/**
 * Derive the stable plugin id used for routes, storage, settings, and CLI
 * commands from an npm package name.
 *
 * `bb-plugin-linear` becomes `linear`; scoped names first drop the scope.
 */
export function derivePluginId(packageName: string): string {
  const base = packageName.includes("/")
    ? (packageName.split("/").at(-1) ?? packageName)
    : packageName;
  const id = base
    .replace(/^bb-plugin-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  if (id.length === 0) {
    throw new Error(
      `cannot derive a plugin id from package name "${packageName}"`,
    );
  }
  if (coreOwnedPluginDirectoryNames.has(id)) {
    throw new Error(
      `package name "${packageName}" gives plugin id "${id}", which bb reserves for its own folders under plugins/; rename the package`,
    );
  }
  return id;
}

/**
 * Built-in plugins bb no longer ships, each mapped to the plugin that took its
 * place. The server hands a retired plugin's settings to its successor; the
 * app redirects links that still name the retired id.
 */
export const RETIRED_PLUGIN_SUCCESSORS: Readonly<Record<string, string>> = {
  "bb--provider-acp-next": "provider-acp",
};

/**
 * The same path with every segment that names a retired plugin replaced by
 * its successor, or null when no segment does.
 */
export function pathWithRetiredPluginIdsReplaced(
  pathname: string,
): string | null {
  let replaced = false;
  const next = pathname
    .split("/")
    .map((segment) => {
      const successor = Object.hasOwn(RETIRED_PLUGIN_SUCCESSORS, segment)
        ? RETIRED_PLUGIN_SUCCESSORS[segment]
        : undefined;
      if (successor === undefined) return segment;
      replaced = true;
      return successor;
    })
    .join("/");
  return replaced ? next : null;
}
