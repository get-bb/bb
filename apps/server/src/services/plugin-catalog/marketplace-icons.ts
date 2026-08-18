import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import {
  listPluginMarketplaceIcons,
  type DbConnection,
  type PluginMarketplaceIconRow,
  type UpsertPluginMarketplaceIconInput,
} from "@bb/db";
import { assertValidPluginCompactIconSvg } from "@bb/plugin-build";
import {
  assertPublicMarketplaceUrl,
  boundedResponseBytes,
  marketplaceErrorMessage,
  MARKETPLACE_FETCH_TIMEOUT_MS,
  type MarketplaceFetch,
} from "./marketplace-http.js";
import { realPathInside } from "../plugins/install-sources.js";
import {
  resolveEntryIcon,
  type MarketplaceEntry,
  type MarketplaceIconBase,
  type MarketplaceIconLocation,
} from "./marketplace-manifest.js";

/** Real logo assets are a few KB; this only bounds a hostile response. */
const MARKETPLACE_ICON_MAX_BYTES = 256 * 1024;

/** Read one local icon through one handle and stop after the size boundary. */
export async function readBoundedMarketplaceIconFile(
  path: string,
): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("icon is not a regular file");
    const buffer = Buffer.allocUnsafe(MARKETPLACE_ICON_MAX_BYTES + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const result = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > MARKETPLACE_ICON_MAX_BYTES) {
      throw new Error(`icon exceeds ${MARKETPLACE_ICON_MAX_BYTES} bytes`);
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

/**
 * Every icon of one marketplace together. The per-icon cap alone still lets a
 * large catalog store tens of megabytes of BLOB data in one refresh.
 */
export const MARKETPLACE_ICON_TOTAL_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Icon requests that run at the same time. Serial fetches multiply the
 * per-request timeout by the entry count, so one slow host could hold a
 * refresh for hours.
 */
const MARKETPLACE_ICON_CONCURRENCY = 6;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWithBytes(bytes: Uint8Array, magic: number[]): boolean {
  return (
    bytes.length >= magic.length &&
    magic.every((byte, index) => bytes[index] === byte)
  );
}

function isWebp(bytes: Uint8Array): boolean {
  const ascii = (offset: number, text: string): boolean =>
    bytes.length >= offset + text.length &&
    text
      .split("")
      .every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  return ascii(0, "RIFF") && ascii(8, "WEBP");
}

/**
 * Validate downloaded icon bytes against the format the URL declares, and
 * return the content type BB will serve them as. SVG goes through the same
 * sanitizer the plugin manifest uses; raster formats are checked by magic
 * bytes, so a mislabelled or hostile payload never reaches the app.
 */
export function marketplaceIconContentType(
  iconUrl: string,
  bytes: Uint8Array,
): string {
  return marketplaceIconContentTypeForPath(new URL(iconUrl).pathname, bytes);
}

/** The same validation for an icon read from disk, keyed on its file name. */
export function marketplaceIconContentTypeForPath(
  filePath: string,
  bytes: Uint8Array,
): string {
  const pathname = filePath.toLowerCase();
  if (bytes.byteLength > MARKETPLACE_ICON_MAX_BYTES) {
    throw new Error(`icon exceeds ${MARKETPLACE_ICON_MAX_BYTES} bytes`);
  }
  if (pathname.endsWith(".svg")) {
    assertValidPluginCompactIconSvg(bytes, "icon");
    return "image/svg+xml";
  }
  if (pathname.endsWith(".png")) {
    if (!startsWithBytes(bytes, PNG_MAGIC)) {
      throw new Error("icon is not a PNG file");
    }
    return "image/png";
  }
  if (pathname.endsWith(".webp")) {
    if (!isWebp(bytes)) throw new Error("icon is not a WebP file");
    return "image/webp";
  }
  throw new Error("icon must be a .svg, .png, or .webp file");
}

/**
 * Fetch, validate, and cache the image icons a refreshed manifest declares.
 *
 * Icons are fetched here, by the server, so the app never requests a
 * third-party URL and the cached catalog stays renderable offline. A failed
 * icon is dropped with a warning: the entry keeps its default glyph, and
 * neither the entry nor the catalog is invalidated. An icon whose URL and
 * ETag are unchanged is revalidated conditionally and usually not re-read.
 *
 * `entries` is always the whole catalog — icons of entries it no longer lists
 * are dropped. `onlyMissing` (an unchanged manifest) retries entries with no
 * cached icon without re-reading the ones already cached.
 *
 * `base` decides where a relative icon comes from: the manifest URL for an
 * https marketplace, the checkout or directory for a git or path one. Local
 * icons are read through {@link realPathInside}, so a symlink cannot pull
 * bytes out of the checkout.
 */
export async function fetchMarketplaceIcons(args: {
  db: DbConnection;
  marketplaceName: string;
  base: MarketplaceIconBase;
  entries: readonly MarketplaceEntry[];
  onlyMissing: boolean;
  fetch: MarketplaceFetch;
  warn?: (message: string) => void;
}): Promise<UpsertPluginMarketplaceIconInput[]> {
  const wanted = new Map<string, MarketplaceIconLocation>();
  for (const entry of args.entries) {
    let icon: MarketplaceIconLocation | null;
    try {
      icon = resolveEntryIcon(entry, args.base);
    } catch (error) {
      args.warn?.(
        `marketplace ${args.marketplaceName} entry "${entry.id}": ${marketplaceErrorMessage(error)}`,
      );
      continue;
    }
    if (icon !== null) wanted.set(entry.id, icon);
  }

  const cachedByEntryId = new Map(
    listPluginMarketplaceIcons(args.db, args.marketplaceName).map((icon) => [
      icon.entryId,
      icon,
    ]),
  );
  const resolved = new Map<string, UpsertPluginMarketplaceIconInput>();
  const pending = [...wanted.entries()];
  let totalBytes = 0;
  // A budget failure is a refresh failure, not a dropped icon: the catalog
  // asks for more icon storage than BB gives one marketplace.
  let budgetError: Error | null = null;

  const keep = (
    entryId: string,
    icon: UpsertPluginMarketplaceIconInput,
  ): void => {
    totalBytes += icon.bytes.byteLength;
    if (totalBytes > MARKETPLACE_ICON_TOTAL_MAX_BYTES) {
      budgetError ??= new Error(
        `marketplace icons exceed the ${MARKETPLACE_ICON_TOTAL_MAX_BYTES} byte total limit`,
      );
      return;
    }
    resolved.set(entryId, icon);
  };

  const runOne = async (
    entryId: string,
    icon: MarketplaceIconLocation,
  ): Promise<void> => {
    const sourceUrl = iconSourceUrl(icon);
    const cached = cachedByEntryId.get(entryId);
    const unchangedUrl = cached?.sourceUrl === sourceUrl;
    // A local icon lives in a checkout bb just materialized, so there is no
    // conditional request to make and re-reading it is a local file read.
    if (
      args.onlyMissing &&
      icon.kind === "remote" &&
      cached !== undefined &&
      unchangedUrl
    ) {
      keep(entryId, iconInputFromRow(cached));
      return;
    }
    try {
      const refreshed =
        icon.kind === "local"
          ? await readOneLocalIcon({
              marketplaceName: args.marketplaceName,
              entryId,
              icon,
              base: args.base,
            })
          : await fetchOneIcon({
              marketplaceName: args.marketplaceName,
              entryId,
              iconUrl: icon.url,
              cached,
              fetch: args.fetch,
            });
      if (refreshed !== null) {
        keep(entryId, refreshed);
      } else if (cached !== undefined && unchangedUrl) {
        keep(entryId, iconInputFromRow(cached));
      }
    } catch (error) {
      args.warn?.(
        `marketplace ${args.marketplaceName} entry "${entryId}" icon ${sourceUrl} was rejected: ${marketplaceErrorMessage(error)}`,
      );
      // A failed revalidation keeps the matching last-known-good asset. An
      // asset from a previous URL does not describe the new catalog.
      if (cached !== undefined && unchangedUrl) {
        keep(entryId, iconInputFromRow(cached));
      }
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (budgetError !== null) return;
      const next = pending.shift();
      if (next === undefined) return;
      await runOne(next[0], next[1]);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MARKETPLACE_ICON_CONCURRENCY, pending.length) },
      worker,
    ),
  );
  if (budgetError !== null) throw budgetError;

  // Catalog order, not completion order, so a stored snapshot is stable.
  return [...wanted.keys()]
    .map((entryId) => resolved.get(entryId))
    .filter(
      (icon): icon is UpsertPluginMarketplaceIconInput => icon !== undefined,
    );
}

/** Stable identity of an icon's origin, stored so a moved icon refetches. */
function iconSourceUrl(icon: MarketplaceIconLocation): string {
  return icon.kind === "remote" ? icon.url : `file:${icon.relativePath}`;
}

async function readOneLocalIcon(args: {
  marketplaceName: string;
  entryId: string;
  icon: Extract<MarketplaceIconLocation, { kind: "local" }>;
  base: MarketplaceIconBase;
}): Promise<UpsertPluginMarketplaceIconInput> {
  if (args.base.kind !== "dir") {
    throw new Error("local icons require a directory base");
  }
  const path = await realPathInside(
    args.base.root,
    args.icon.path,
    `entry "${args.entryId}" icon`,
  );
  const bytes = await readBoundedMarketplaceIconFile(path);
  return {
    marketplaceName: args.marketplaceName,
    entryId: args.entryId,
    sourceUrl: iconSourceUrl(args.icon),
    contentType: marketplaceIconContentTypeForPath(
      args.icon.relativePath,
      bytes,
    ),
    etag: null,
    contentHash: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    bytes: Buffer.from(bytes),
  };
}

function iconInputFromRow(
  row: PluginMarketplaceIconRow,
): UpsertPluginMarketplaceIconInput {
  const { updatedAt: _updatedAt, ...input } = row;
  return input;
}

async function fetchOneIcon(args: {
  marketplaceName: string;
  entryId: string;
  iconUrl: string;
  cached: PluginMarketplaceIconRow | undefined;
  fetch: MarketplaceFetch;
}): Promise<UpsertPluginMarketplaceIconInput | null> {
  // The entry, not BB, chose this URL. It gets the manifest's own network
  // policy even when a caller injects its own fetch.
  assertPublicMarketplaceUrl(args.iconUrl);
  const cached = args.cached;
  const unchangedUrl =
    cached !== undefined && cached.sourceUrl === args.iconUrl;
  const headers = new Headers({ accept: "image/*" });
  if (unchangedUrl && cached.etag !== null) {
    headers.set("if-none-match", cached.etag);
  }
  const response = await args.fetch(args.iconUrl, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(MARKETPLACE_FETCH_TIMEOUT_MS),
  });
  if (response.status === 304 && unchangedUrl) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`request failed with HTTP ${response.status}`);
  }
  const bytes = await boundedResponseBytes(
    response,
    MARKETPLACE_ICON_MAX_BYTES,
    "icon",
  );
  const contentType = marketplaceIconContentType(args.iconUrl, bytes);
  return {
    marketplaceName: args.marketplaceName,
    entryId: args.entryId,
    sourceUrl: args.iconUrl,
    contentType,
    etag: response.headers.get("etag"),
    contentHash: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    bytes: Buffer.from(bytes),
  };
}
