import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { PLUGIN_SDK_MAJOR } from "@bb/domain";

/**
 * Frontend bundle inventory + asset state for plugins that declare `bb.app`
 * (design §5.1). The plugin service refreshes this per load (install, boot,
 * reload); GET /api/v1/plugins serves the wire shape and the asset routes
 * serve the recorded file paths with the recorded content hash.
 */

/** Wire shape of one plugin's loadable frontend bundle (GET /api/v1/plugins). */
export interface PluginAppBundleInfo {
  /** App-relative asset URL, content-hash query included. */
  jsUrl: string;
  /** Null when the plugin ships no dist/app.css (host loads JS only). */
  cssUrl: string | null;
  /** sha256 (first 16 hex chars) over dist/app.js + dist/app.css +
   * dist/app.meta.json bytes. Meta rides the hash so an SDK-version-only
   * change (identical js/css) still re-keys frontend reconcile + caching. */
  hash: string;
  /** SDK version stamped into dist/app.meta.json at build time. */
  sdkMajor: number;
  sdkVersion: string;
  /** False when sdkMajor differs from the running PLUGIN_SDK_MAJOR — the
   * frontend skips the bundle ("needs update"); the backend keeps running. */
  compatible: boolean;
}

/** App-bundle slice of a GET /api/v1/plugins entry. */
export interface PluginAppState {
  /** Whether the manifest declares a `bb.app` frontend entry. */
  hasApp: boolean;
  /** Null when dist/app.js or dist/app.meta.json is missing/unreadable. */
  bundle: PluginAppBundleInfo | null;
}

/** On-disk asset record backing GET /plugins/:id/assets/*. */
export interface PluginAppAssets {
  jsPath: string;
  cssPath: string | null;
  hash: string;
}

export interface PluginAppBundleSnapshot {
  state: PluginAppState;
  assets: PluginAppAssets | null;
}

/**
 * Parse `dist/app.meta.json` contents strictly, or null when malformed:
 * sdkMajor must be a non-negative safe integer, sdkVersion a valid semver,
 * and the two must agree (semver.major(sdkVersion) === sdkMajor) — an
 * inconsistent sidecar would make the compatibility gate lie.
 */
export function parsePluginAppBundleMeta(
  raw: string,
): { sdkMajor: number; sdkVersion: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const meta = json as { sdkMajor?: unknown; sdkVersion?: unknown } | null;
  if (
    typeof meta?.sdkMajor !== "number" ||
    !Number.isSafeInteger(meta.sdkMajor) ||
    meta.sdkMajor < 0 ||
    typeof meta.sdkVersion !== "string" ||
    semver.valid(meta.sdkVersion) === null ||
    semver.major(meta.sdkVersion) !== meta.sdkMajor
  ) {
    return null;
  }
  return { sdkMajor: meta.sdkMajor, sdkVersion: meta.sdkVersion };
}

/** `dist/app.meta.json` contents, or null when missing/malformed. */
export async function readPluginAppBundleMeta(
  rootDir: string,
): Promise<{ sdkMajor: number; sdkVersion: string } | null> {
  let raw: string;
  try {
    raw = await readFile(join(rootDir, "dist", "app.meta.json"), "utf8");
  } catch {
    return null;
  }
  return parsePluginAppBundleMeta(raw);
}

/**
 * Read `<rootDir>/dist/` into a servable snapshot. Missing/unreadable
 * app.js or app.meta.json → `bundle: null` (the frontend has nothing to
 * load); a missing app.css is fine (`cssUrl: null`).
 */
export async function loadPluginAppBundle(
  pluginId: string,
  rootDir: string,
): Promise<PluginAppBundleSnapshot> {
  const distDir = join(rootDir, "dist");
  const jsPath = join(distDir, "app.js");
  const cssPath = join(distDir, "app.css");
  let metaRaw: string;
  try {
    metaRaw = await readFile(join(distDir, "app.meta.json"), "utf8");
  } catch {
    return { state: { hasApp: true, bundle: null }, assets: null };
  }
  const meta = parsePluginAppBundleMeta(metaRaw);
  let js: Buffer;
  try {
    js = await readFile(jsPath);
  } catch {
    return { state: { hasApp: true, bundle: null }, assets: null };
  }
  if (meta === null) {
    return { state: { hasApp: true, bundle: null }, assets: null };
  }
  let css: Buffer | null;
  try {
    css = await readFile(cssPath);
  } catch {
    css = null;
  }
  // Meta bytes ride the hash: a meta-only change (same js/css) must still
  // produce a fresh hash, or the frontend's hash-keyed reconcile would never
  // re-evaluate compatibility and the immutable asset cache would never key
  // off the new state.
  const hasher = createHash("sha256").update(js);
  if (css !== null) hasher.update(css);
  hasher.update(metaRaw);
  const hash = hasher.digest("hex").slice(0, 16);
  const assetUrl = (file: string) =>
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/assets/${file}?h=${hash}`;
  return {
    state: {
      hasApp: true,
      bundle: {
        jsUrl: assetUrl("app.js"),
        cssUrl: css !== null ? assetUrl("app.css") : null,
        hash,
        sdkMajor: meta.sdkMajor,
        sdkVersion: meta.sdkVersion,
        compatible: meta.sdkMajor === PLUGIN_SDK_MAJOR,
      },
    },
    assets: { jsPath, cssPath: css !== null ? cssPath : null, hash },
  };
}
