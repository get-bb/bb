import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { PLUGIN_SDK_MAJOR } from "@bb/domain";
import { assertValidPluginCompactIconSvg } from "@bb/plugin-build";

export interface PluginArtifactMeta {
  sdkMajor: number;
  sdkVersion: string;
  artifactFormatVersion?: 1;
  pluginId?: string;
  pluginVersion?: string;
  builtWith?: {
    bbVersion: string;
    pluginSdkVersion: string;
  };
}

export interface PluginArtifactMetaParseResult {
  meta: PluginArtifactMeta | null;
  error: string | null;
}

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
  /** Byte size of dist/app.js. The frontend loads smaller bundles first so
   * a phone gets several light plugins on screen before one heavy one. */
  jsBytes: number;
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

// ---------------------------------------------------------------------------
// Plugin branding assets from path-shaped `bb.branding.icon` values and
// `bb.branding.logo`. Served with the same hash-busting scheme as bundle
// assets and refreshed on every load like the bundle snapshot.
// ---------------------------------------------------------------------------

const BRANDING_ASSET_CONTENT_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
};

/** Stable route names for plugin-owned branding assets. */
export type PluginBrandingAssetVariant = "icon" | "logo" | "logo-dark";

/** Immutable byte snapshot backing one GET /plugins/:id/assets/<variant>. */
export interface PluginBrandingAssetSnapshot {
  /** App-relative asset URL, content-hash query included. */
  url: string;
  /** The exact bytes used to compute `hash`; never re-read from source. */
  bytes: Uint8Array;
  contentType: string;
  /** sha256 (first 16 hex chars) over the asset bytes. */
  hash: string;
}

/** All declared branding assets of one plugin; each is null when absent. */
export interface PluginBrandingAssetSet {
  compactIcon: PluginBrandingAssetSnapshot | null;
  logo: PluginBrandingAssetSnapshot | null;
  logoDark: PluginBrandingAssetSnapshot | null;
}

/**
 * Read and hash one explicitly declared branding asset. Manifest parsing has
 * already validated that the path is a readable supported asset.
 */
async function loadPluginBrandingAsset(
  pluginId: string,
  manifestPath: string | undefined,
  variant: PluginBrandingAssetVariant,
): Promise<PluginBrandingAssetSnapshot | null> {
  if (manifestPath === undefined) return null;
  const bytes = await readFile(manifestPath);
  if (variant === "icon") {
    assertValidPluginCompactIconSvg(bytes);
  }
  const extension = manifestPath
    .slice(manifestPath.lastIndexOf(".") + 1)
    .toLowerCase();
  const contentType = BRANDING_ASSET_CONTENT_TYPES[extension];
  if (contentType === undefined) return null;
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return {
    url: `/api/v1/plugins/${encodeURIComponent(pluginId)}/assets/${variant}?h=${hash}`,
    bytes,
    contentType,
    hash,
  };
}

/** Read and hash every explicitly declared branding asset. */
export async function loadPluginBrandingAssets(
  pluginId: string,
  manifest: {
    branding: {
      compactIconPath?: string;
      logo?: { lightPath: string; darkPath?: string };
    };
  },
): Promise<PluginBrandingAssetSet> {
  return {
    compactIcon: await loadPluginBrandingAsset(
      pluginId,
      manifest.branding.compactIconPath,
      "icon",
    ),
    logo: await loadPluginBrandingAsset(
      pluginId,
      manifest.branding.logo?.lightPath,
      "logo",
    ),
    logoDark: await loadPluginBrandingAsset(
      pluginId,
      manifest.branding.logo?.darkPath,
      "logo-dark",
    ),
  };
}

/**
 * Parse `dist/app.meta.json` contents strictly, or null when malformed:
 * sdkMajor must be a non-negative safe integer, sdkVersion a valid semver,
 * and the two must agree (semver.major(sdkVersion) === sdkMajor) — an
 * inconsistent sidecar would make the compatibility gate lie.
 */
export function parsePluginArtifactMeta(
  raw: string,
): PluginArtifactMetaParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { meta: null, error: "metadata is not valid JSON" };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { meta: null, error: "metadata must be a JSON object" };
  }
  const meta = Object.fromEntries(Object.entries(json));
  if (
    typeof meta.sdkMajor !== "number" ||
    !Number.isSafeInteger(meta.sdkMajor) ||
    meta.sdkMajor < 0 ||
    typeof meta.sdkVersion !== "string" ||
    semver.valid(meta.sdkVersion) === null ||
    semver.major(meta.sdkVersion) !== meta.sdkMajor
  ) {
    return {
      meta: null,
      error:
        "sdkMajor must be a non-negative integer and must match the valid semver sdkVersion",
    };
  }
  const authoritativeKeys = [
    "artifactFormatVersion",
    "pluginId",
    "pluginVersion",
    "builtWith",
  ];
  const hasAuthoritativeField = authoritativeKeys.some((key) => key in meta);
  if (!hasAuthoritativeField) {
    return {
      meta: { sdkMajor: meta.sdkMajor, sdkVersion: meta.sdkVersion },
      error: null,
    };
  }
  if (meta.artifactFormatVersion !== 1) {
    return {
      meta: null,
      error: `unknown artifactFormatVersion ${JSON.stringify(meta.artifactFormatVersion)}; supported value is 1`,
    };
  }
  if (typeof meta.pluginId !== "string" || meta.pluginId.length === 0) {
    return { meta: null, error: "pluginId must be a non-empty string" };
  }
  if (
    typeof meta.pluginVersion !== "string" ||
    meta.pluginVersion.length === 0
  ) {
    return { meta: null, error: "pluginVersion must be a non-empty string" };
  }
  if (
    typeof meta.builtWith !== "object" ||
    meta.builtWith === null ||
    Array.isArray(meta.builtWith)
  ) {
    return { meta: null, error: "builtWith must be an object" };
  }
  const builtWith = Object.fromEntries(Object.entries(meta.builtWith));
  if (
    typeof builtWith.bbVersion !== "string" ||
    builtWith.bbVersion.length === 0 ||
    typeof builtWith.pluginSdkVersion !== "string" ||
    semver.valid(builtWith.pluginSdkVersion) === null
  ) {
    return {
      meta: null,
      error:
        "builtWith.bbVersion must be non-empty and builtWith.pluginSdkVersion must be a valid semver",
    };
  }
  if (builtWith.pluginSdkVersion !== meta.sdkVersion) {
    return {
      meta: null,
      error: `builtWith.pluginSdkVersion ${builtWith.pluginSdkVersion} does not match sdkVersion ${meta.sdkVersion}`,
    };
  }
  return {
    meta: {
      sdkMajor: meta.sdkMajor,
      sdkVersion: meta.sdkVersion,
      artifactFormatVersion: 1,
      pluginId: meta.pluginId,
      pluginVersion: meta.pluginVersion,
      builtWith: {
        bbVersion: builtWith.bbVersion,
        pluginSdkVersion: builtWith.pluginSdkVersion,
      },
    },
    error: null,
  };
}

export function parsePluginAppBundleMeta(
  raw: string,
): PluginArtifactMeta | null {
  return parsePluginArtifactMeta(raw).meta;
}

/** Validate one install artifact against the running SDK and its manifest. */
export function validatePluginArtifactMeta(args: {
  artifact: "server" | "app" | "host";
  raw: string;
  pluginId: string;
  pluginVersion: string;
}): string | null {
  const parsed = parsePluginArtifactMeta(args.raw);
  if (parsed.meta === null) {
    return `${args.artifact} artifact for plugin "${args.pluginId}" has invalid metadata: ${parsed.error ?? "unknown error"}`;
  }
  const meta = parsed.meta;
  if (meta.sdkMajor !== PLUGIN_SDK_MAJOR) {
    return `${args.artifact} artifact for plugin "${args.pluginId}" was built for SDK major ${meta.sdkMajor}, running SDK major is ${PLUGIN_SDK_MAJOR}; rebuild the ${args.artifact} artifact with this bb version`;
  }
  if (meta.artifactFormatVersion !== 1) return null;
  if (meta.pluginId !== args.pluginId) {
    return `${args.artifact} artifact pluginId "${meta.pluginId}" does not match manifest pluginId "${args.pluginId}"`;
  }
  if (meta.pluginVersion !== args.pluginVersion) {
    return `${args.artifact} artifact pluginVersion "${meta.pluginVersion}" does not match manifest version "${args.pluginVersion}"`;
  }
  return null;
}

/** `dist/app.meta.json` contents, or null when missing/malformed. */
export async function readPluginAppBundleMeta(
  rootDir: string,
): Promise<PluginArtifactMeta | null> {
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
        jsBytes: js.byteLength,
        hash,
        sdkMajor: meta.sdkMajor,
        sdkVersion: meta.sdkVersion,
        compatible: meta.sdkMajor === PLUGIN_SDK_MAJOR,
      },
    },
    assets: { jsPath, cssPath: css !== null ? cssPath : null, hash },
  };
}
