import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { PLUGIN_SDK_MAJOR } from "@bb/domain";
import {
  assertValidPluginCompactIconSvg,
  assertValidPluginIconSvg,
  PLUGIN_APP_CHUNK_DIRECTORY,
  RUNTIME_SLOT_BY_SPECIFIER,
  dropAnonymousPluginRootScope,
  dropHostProvidedTailwind,
  findUnnamedPluginRoots,
  keyPluginScopeOnAttribute,
} from "@bb/plugin-build";

interface PluginArtifactMeta {
  sdkMajor: number;
  sdkVersion: string;
  artifactFormatVersion?: 1 | 2;
  pluginId?: string;
  pluginVersion?: string;
  builtWith?: {
    bbVersion: string;
    pluginSdkVersion: string;
  };
  runtimeSlots?: string[];
  chunks?: PluginAppChunkMeta;
}

interface PluginAppChunkMeta {
  files: string[];
  entryFiles: string[];
  runtimeSlots: string[];
}

interface PluginArtifactMetaParseResult {
  meta: PluginArtifactMeta | null;
  error: string | null;
}

interface PluginAppBundleInfo {
  jsUrl: string;
  cssUrl: string | null;
  jsBytes: number;
  hash: string;
  sdkMajor: number;
  sdkVersion: string;
  compatible: boolean;
  runtimeSlots: string[];
  staticChunkUrls: string[];
  lazyChunkUrls: string[];
  lazyRuntimeSlots: string[];
}

interface PluginAppState {
  hasApp: boolean;
  bundle: PluginAppBundleInfo | null;
}

interface PluginCssBytes {
  original: Buffer;
  withoutHostTailwind: Buffer;
}

interface PluginAppChunk {
  path: string;
  digest: string;
}

interface PluginAppAssets {
  jsPath: string;
  chunks: ReadonlyMap<string, PluginAppChunk>;
  css: PluginCssBytes | null;
  ownedRootCss: PluginCssBytes | null;
  pluginAttributeCss: PluginCssBytes | null;
  hash: string;
}

export type PluginCssScope = "legacy" | "owned-root" | "plugin-attribute";

export interface PluginAppAsset {
  hash: string;
  read(options: {
    hostTailwind: boolean;
    scope: PluginCssScope;
  }): Promise<Buffer>;
}

export function pluginAppAsset(
  assets: PluginAppAssets,
  kind: "js" | "css",
): PluginAppAsset | undefined {
  if (kind === "js")
    return { hash: assets.hash, read: () => readFile(assets.jsPath) };
  const css = assets.css;
  return css === null
    ? undefined
    : {
        hash: assets.hash,
        read: async ({ hostTailwind, scope }) => {
          const ownedRoot = assets.ownedRootCss ?? css;
          const selected =
            scope === "plugin-attribute"
              ? (assets.pluginAttributeCss ?? ownedRoot)
              : scope === "owned-root"
                ? ownedRoot
                : css;
          return hostTailwind
            ? selected.withoutHostTailwind
            : selected.original;
        },
      };
}

export function pluginAppChunk(
  assets: PluginAppAssets,
  file: string,
): PluginAppAsset | undefined {
  const chunk = assets.chunks.get(file);
  if (chunk === undefined) return undefined;
  return {
    hash: assets.hash,
    read: async () => {
      const bytes = await readFile(chunk.path);
      if (sha256(bytes) !== chunk.digest) {
        throw new Error(`plugin app chunk ${file} changed since it was loaded`);
      }
      return bytes;
    },
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface PluginAppBundleSnapshot {
  state: PluginAppState;
  assets: PluginAppAssets | null;
}

const BRANDING_ASSET_CONTENT_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
};

export type PluginBrandingAssetVariant = "icon" | "logo" | "logo-dark";

export interface PluginBrandingAssetSnapshot {
  url: string;
  bytes: Uint8Array;
  contentType: string;
  hash: string;
}

export interface PluginBrandingAssetSet {
  compactIcon: PluginBrandingAssetSnapshot | null;
  logo: PluginBrandingAssetSnapshot | null;
  logoDark: PluginBrandingAssetSnapshot | null;
  icons: ReadonlyMap<string, PluginBrandingAssetSnapshot>;
}

export function brandingAssetHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

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
  const hash = brandingAssetHash(bytes);
  return {
    url: `/api/v1/plugins/${encodeURIComponent(pluginId)}/assets/${variant}?h=${hash}`,
    bytes,
    contentType,
    hash,
  };
}

async function loadPluginIconAsset(
  pluginId: string,
  name: string,
  path: string,
): Promise<PluginBrandingAssetSnapshot> {
  const bytes = await readFile(path);
  assertValidPluginIconSvg(bytes, `bb.branding.experimental_icons["${name}"]`);
  const hash = brandingAssetHash(bytes);
  return {
    url: `/api/v1/plugins/${encodeURIComponent(pluginId)}/assets/icons/${encodeURIComponent(name)}.svg?h=${hash}`,
    bytes,
    contentType: "image/svg+xml",
    hash,
  };
}

export async function loadPluginBrandingAssets(
  pluginId: string,
  manifest: {
    branding: {
      compactIconPath?: string;
      logo?: { lightPath: string; darkPath?: string };
      icons: ReadonlyMap<string, string>;
    };
  },
): Promise<PluginBrandingAssetSet> {
  const icons = new Map<string, PluginBrandingAssetSnapshot>();
  for (const [name, path] of manifest.branding.icons) {
    icons.set(name, await loadPluginIconAsset(pluginId, name, path));
  }
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
    icons,
  };
}

function parsePluginArtifactMeta(raw: string): PluginArtifactMetaParseResult {
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
  let runtimeSlots: string[] | undefined;
  if ("runtimeSlots" in meta) {
    if (
      !Array.isArray(meta.runtimeSlots) ||
      !meta.runtimeSlots.every((slot) => typeof slot === "string")
    ) {
      return { meta: null, error: "runtimeSlots must be an array of strings" };
    }
    runtimeSlots = meta.runtimeSlots;
  }
  const chunks = parsePluginAppChunkMeta(meta);
  if (typeof chunks === "string") return { meta: null, error: chunks };
  const authoritativeKeys = [
    "artifactFormatVersion",
    "pluginId",
    "pluginVersion",
    "builtWith",
  ];
  const hasAuthoritativeField = authoritativeKeys.some((key) => key in meta);
  if (!hasAuthoritativeField) {
    if (chunks !== undefined) {
      return {
        meta: null,
        error: "an app bundle with chunks needs artifactFormatVersion 2",
      };
    }
    return {
      meta: {
        sdkMajor: meta.sdkMajor,
        sdkVersion: meta.sdkVersion,
        ...(runtimeSlots !== undefined ? { runtimeSlots } : {}),
      },
      error: null,
    };
  }
  const formatVersion = meta.artifactFormatVersion;
  if (formatVersion !== 1 && formatVersion !== 2) {
    return {
      meta: null,
      error: `unknown artifactFormatVersion ${JSON.stringify(formatVersion)}; supported values are 1 and 2`,
    };
  }
  if (chunks !== undefined && formatVersion !== 2) {
    return {
      meta: null,
      error: "an app bundle with chunks needs artifactFormatVersion 2",
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
      artifactFormatVersion: formatVersion,
      pluginId: meta.pluginId,
      pluginVersion: meta.pluginVersion,
      builtWith: {
        bbVersion: builtWith.bbVersion,
        pluginSdkVersion: builtWith.pluginSdkVersion,
      },
      ...(runtimeSlots !== undefined ? { runtimeSlots } : {}),
      ...(chunks !== undefined ? { chunks } : {}),
    },
    error: null,
  };
}

const PLUGIN_APP_CHUNK_FILE_PATTERN = new RegExp(
  `^${PLUGIN_APP_CHUNK_DIRECTORY}/[A-Za-z0-9_-]+\\.js$`,
  "u",
);

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function parsePluginAppChunkMeta(
  meta: Record<string, unknown>,
): PluginAppChunkMeta | undefined | string {
  if (!("chunks" in meta)) return undefined;
  const { chunks, entryChunks, chunkRuntimeSlots } = meta;
  if (
    !isStringArray(chunks) ||
    !chunks.every((file) => PLUGIN_APP_CHUNK_FILE_PATTERN.test(file))
  ) {
    return `chunks must be an array of ${PLUGIN_APP_CHUNK_DIRECTORY}/<name>.js files`;
  }
  if (
    !isStringArray(entryChunks) ||
    !entryChunks.every((file) => chunks.includes(file))
  ) {
    return "entryChunks must list files from chunks";
  }
  if (!isStringArray(chunkRuntimeSlots)) {
    return "chunkRuntimeSlots must be an array of strings";
  }
  return {
    files: chunks,
    entryFiles: entryChunks,
    runtimeSlots: chunkRuntimeSlots,
  };
}

const ALL_RUNTIME_SLOTS = [
  ...new Set(Object.values(RUNTIME_SLOT_BY_SPECIFIER)),
].sort();

export function parsePluginAppBundleMeta(
  raw: string,
): PluginArtifactMeta | null {
  return parsePluginArtifactMeta(raw).meta;
}

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
  if (meta.artifactFormatVersion === undefined) return null;
  if (meta.pluginId !== args.pluginId) {
    return `${args.artifact} artifact pluginId "${meta.pluginId}" does not match manifest pluginId "${args.pluginId}"`;
  }
  if (meta.pluginVersion !== args.pluginVersion) {
    return `${args.artifact} artifact pluginVersion "${meta.pluginVersion}" does not match manifest version "${args.pluginVersion}"`;
  }
  return null;
}

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

function transformCss(
  css: PluginCssBytes,
  transform: (css: string) => string,
): PluginCssBytes {
  return {
    original: Buffer.from(transform(css.original.toString("utf8"))),
    withoutHostTailwind: Buffer.from(
      transform(css.withoutHostTailwind.toString("utf8")),
    ),
  };
}

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
  const chunkMeta = meta.chunks ?? {
    files: [],
    entryFiles: [],
    runtimeSlots: [],
  };
  const chunkSources: { file: string; path: string; bytes: Buffer }[] = [];
  for (const file of chunkMeta.files) {
    const path = join(distDir, file);
    try {
      chunkSources.push({ file, path, bytes: await readFile(path) });
    } catch {
      return { state: { hasApp: true, bundle: null }, assets: null };
    }
  }
  let css: PluginAppAssets["css"];
  try {
    const original = await readFile(cssPath);
    css = {
      original,
      withoutHostTailwind: Buffer.from(
        dropHostProvidedTailwind(original.toString("utf8")),
      ),
    };
  } catch {
    css = null;
  }
  const ownsEveryRoot = [js, ...chunkSources.map((chunk) => chunk.bytes)].every(
    (source) => findUnnamedPluginRoots(source.toString("utf8")).length === 0,
  );
  const ownedRootCss =
    css !== null && ownsEveryRoot
      ? transformCss(css, dropAnonymousPluginRootScope)
      : null;
  const pluginAttributeCss =
    css !== null && ownsEveryRoot
      ? transformCss(css, keyPluginScopeOnAttribute)
      : null;
  const hasher = createHash("sha256").update(js);
  for (const chunk of chunkSources) {
    hasher.update(chunk.file);
    hasher.update(chunk.bytes);
  }
  for (const variant of [css, ownedRootCss, pluginAttributeCss]) {
    if (variant === null) continue;
    hasher.update(variant.original);
    hasher.update(variant.withoutHostTailwind);
  }
  hasher.update(metaRaw);
  hasher.update(pluginId);
  const hash = hasher.digest("hex").slice(0, 16);
  const assetUrl = (file: string) =>
    `/api/v1/plugin-app-assets/${hash}/${file}`;
  return {
    state: {
      hasApp: true,
      bundle: {
        jsUrl: assetUrl("app.js"),
        cssUrl: css !== null ? assetUrl("app.css") : null,
        jsBytes:
          js.byteLength +
          chunkSources
            .filter((chunk) => chunkMeta.entryFiles.includes(chunk.file))
            .reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
        hash,
        sdkMajor: meta.sdkMajor,
        sdkVersion: meta.sdkVersion,
        compatible: meta.sdkMajor === PLUGIN_SDK_MAJOR,
        runtimeSlots: meta.runtimeSlots ?? ALL_RUNTIME_SLOTS,
        staticChunkUrls: chunkMeta.entryFiles.map(assetUrl),
        lazyChunkUrls: chunkMeta.files
          .filter((file) => !chunkMeta.entryFiles.includes(file))
          .map(assetUrl),
        lazyRuntimeSlots: chunkMeta.runtimeSlots,
      },
    },
    assets: {
      jsPath,
      chunks: new Map(
        chunkSources.map((chunk) => [
          chunk.file.slice(PLUGIN_APP_CHUNK_DIRECTORY.length + 1),
          { path: chunk.path, digest: sha256(chunk.bytes) },
        ]),
      ),
      css,
      ownedRootCss,
      pluginAttributeCss,
      hash,
    },
  };
}
