import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The @get-bb/plugin-sdk declaration bundles `bb plugin types|build|dev` write
 * into a vendored-layout plugin's `types/` dir.
 */
export interface PluginSdkDeclarations {
  /** bundled-types/bb-plugin-sdk.d.ts */
  root: string;
  /** bundled-types/bb-plugin-sdk-app.d.ts */
  app: string;
}

/**
 * Packaged builds inline the declarations: the host-daemon CLI bundle defines
 * this identifier (esbuild `define`) as the JSON of a {@link PluginSdkDeclarations}
 * at bundle time, since the packaged app has no workspace on disk. Source and
 * dev builds leave it undefined and read `packages/plugin-sdk/bundled-types/`
 * instead, so `@bb/cli#build` never waits for the SDK's (slow) dts bundle.
 */
declare const __BB_PLUGIN_SDK_DTS_JSON__: string | undefined;

const ROOT_FILE = "bb-plugin-sdk.d.ts";
const APP_FILE = "bb-plugin-sdk-app.d.ts";
const BUNDLED_TYPES_RELATIVE = join("packages", "plugin-sdk", "bundled-types");

let cached: Promise<PluginSdkDeclarations> | null = null;

/** Load the SDK declarations once per process. */
export function loadPluginSdkDeclarations(): Promise<PluginSdkDeclarations> {
  cached ??= loadUncached();
  return cached;
}

async function loadUncached(): Promise<PluginSdkDeclarations> {
  if (typeof __BB_PLUGIN_SDK_DTS_JSON__ === "string") {
    return parseDeclarations(__BB_PLUGIN_SDK_DTS_JSON__);
  }
  const typesDir = findWorkspaceBundledTypesDir();
  if (typesDir === null) {
    throw new Error(
      `Could not find ${BUNDLED_TYPES_RELATIVE} above ${moduleDir()}. ` +
        "Build the plugin SDK declarations first: " +
        "pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk",
    );
  }
  const [root, app] = await Promise.all([
    readFile(join(typesDir, ROOT_FILE), "utf8"),
    readFile(join(typesDir, APP_FILE), "utf8"),
  ]);
  return { root, app };
}

function parseDeclarations(json: string): PluginSdkDeclarations {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("root" in parsed) ||
    !("app" in parsed) ||
    typeof parsed.root !== "string" ||
    typeof parsed.app !== "string"
  ) {
    throw new Error("Inlined plugin SDK declarations have an unexpected shape");
  }
  return { root: parsed.root, app: parsed.app };
}

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Walk up from this module (packages/templates/src in source runs,
 * apps/cli/dist for the dev CLI bundle) to the workspace root and return its
 * bundled-types dir, or null when no ancestor holds one.
 */
function findWorkspaceBundledTypesDir(): string | null {
  let dir = moduleDir();
  for (;;) {
    const candidate = join(dir, BUNDLED_TYPES_RELATIVE);
    if (existsSyncSafe(join(candidate, ROOT_FILE))) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

function existsSyncSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
