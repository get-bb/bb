import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { MAX_PACKAGE_BYTES, parsePackage, readImage } from "./app-package.js";
import {
  catalogIndexSchema,
  compareVersions,
  type CatalogIndex,
  type CatalogListing,
} from "./catalog-format.js";
import { LibraryError, type CatalogView, type Library } from "./library.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export const MEDIA_CACHE_MIGRATIONS = [
  "DROP TABLE community_previews",
  "CREATE TABLE community_media (catalog_id TEXT NOT NULL, path TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (catalog_id, path))",
];

export const CATALOG_MIGRATIONS = [
  "CREATE TABLE community_cache (id INTEGER PRIMARY KEY CHECK (id = 1), url TEXT NOT NULL, revision TEXT, etag TEXT, index_json TEXT, refreshed_at INTEGER, checked_at INTEGER, error TEXT)",
  "CREATE TABLE community_seen (catalog_id TEXT NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY (catalog_id, version))",
  "CREATE TABLE community_previews (catalog_id TEXT PRIMARY KEY, path TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL)",
];

const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_PREVIEW_BYTES = 512 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const STALE_MS = 60 * 60 * 1000;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export type Lookup = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;

function privateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return privateAddress(mapped[1]!);
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

export function catalogBase(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("The Community catalog URL must be a plain https URL.");
  parsed.hash = "";
  parsed.search = "";
  return parsed;
}

export function createCatalog({
  db,
  library,
  fetcher = (url, init) => fetch(url, init),
  lookup = (hostname) => dnsLookup(hostname, { all: true }),
  now = Date.now,
}: {
  db: Db;
  library: () => Library;
  fetcher?: Fetcher;
  lookup?: Lookup;
  now?: () => number;
}) {
  let url: string | null = null;
  let parsed: { json: string; index: CatalogIndex } | null = null;
  type CacheRow = {
    url: string;
    revision: string | null;
    etag: string | null;
    index_json: string | null;
    refreshed_at: number | null;
    checked_at: number | null;
    error: string | null;
  };
  const cacheRow = () => {
    const row = db
      .prepare("SELECT * FROM community_cache WHERE id = 1")
      .get() as CacheRow | undefined;
    return row && row.url === url ? row : undefined;
  };
  const index = (): CatalogIndex | null => {
    const json = cacheRow()?.index_json;
    if (!json) return null;
    if (parsed?.json !== json)
      parsed = { json, index: catalogIndexSchema.parse(JSON.parse(json)) };
    return parsed.index;
  };
  const conflicts = (listing: CatalogListing) =>
    new Set(
      listing.versions
        .filter((v) => {
          const seen = db
            .prepare(
              "SELECT digest FROM community_seen WHERE catalog_id = ? AND version = ?",
            )
            .get(listing.id, v.version) as { digest: string } | undefined;
          return seen !== undefined && seen.digest !== v.digest;
        })
        .map((v) => v.version),
    );

  const fetchLimited = async (
    target: URL,
    limit: number,
    scope: URL,
    headers: Record<string, string> = {},
  ) => {
    if (!url) throw new Error("No Community catalog is configured.");
    const base = catalogBase(url);
    let current = target;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (
        current.protocol !== "https:" ||
        current.origin !== base.origin ||
        !current.pathname.startsWith(scope.pathname)
      )
        throw new Error("The catalog pointed outside its approved location.");
      const host = current.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await lookup(host);
      if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
        throw new Error(
          "The catalog host resolves to a private or local address.",
        );
      const response = await fetcher(current.href, {
        redirect: "manual",
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304
      ) {
        const location = response.headers.get("location");
        if (!location)
          throw new Error("The catalog sent a redirect without a location.");
        current = new URL(location, current);
        continue;
      }
      if (response.status === 304)
        return {
          status: 304,
          headers: response.headers,
          body: Buffer.alloc(0),
        };
      if (!response.ok)
        throw new Error(`The catalog returned HTTP ${response.status}.`);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > limit)
        throw new Error(`The catalog file is larger than ${limit} bytes.`);
      const chunks: Buffer[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) {
            await reader.cancel();
            throw new Error(`The catalog file is larger than ${limit} bytes.`);
          }
          chunks.push(Buffer.from(value));
        }
      return {
        status: response.status,
        headers: response.headers,
        body: Buffer.concat(chunks),
      };
    }
    throw new Error("The catalog redirected too many times.");
  };

  const packageRoot = (catalog: CatalogIndex) => {
    if (!url) throw new Error("No Community catalog is configured.");
    const root = new URL(
      catalog.packages.replace("{revision}", catalog.revision),
    );
    if (root.origin !== catalogBase(url).origin)
      throw new Error("The catalog's package location must share its origin.");
    return root;
  };
  const resolvePath = (path: string) => {
    const current = index();
    if (!current) throw new Error("Refresh the Community catalog first.");
    const root = packageRoot(current);
    return { target: new URL(path, root), scope: root };
  };

  const refresh = async () => {
    if (!url) return status();
    const existing = cacheRow();
    try {
      const response = await fetchLimited(
        catalogBase(url),
        MAX_INDEX_BYTES,
        new URL(".", catalogBase(url)),
        existing?.etag && existing.index_json
          ? { "if-none-match": existing.etag }
          : {},
      );
      if (response.status === 304) {
        db.prepare(
          "UPDATE community_cache SET checked_at = ?, refreshed_at = ?, error = NULL WHERE id = 1",
        ).run(now(), now());
        return status();
      }
      const text = response.body.toString("utf8");
      const parsedIndex = catalogIndexSchema.safeParse(JSON.parse(text));
      if (!parsedIndex.success)
        throw new Error(
          `The catalog index is invalid: ${parsedIndex.error.issues[0]?.message ?? "unknown error"}`,
        );
      const fresh = parsedIndex.data;
      packageRoot(fresh);
      db.transaction(() => {
        for (const app of fresh.apps)
          for (const v of app.versions)
            db.prepare(
              "INSERT OR IGNORE INTO community_seen (catalog_id, version, digest) VALUES (?, ?, ?)",
            ).run(app.id, v.version, v.digest);
        db.prepare(
          "INSERT INTO community_cache (id, url, revision, etag, index_json, refreshed_at, checked_at, error) VALUES (1, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET url = excluded.url, revision = excluded.revision, etag = excluded.etag, index_json = excluded.index_json, refreshed_at = excluded.refreshed_at, checked_at = excluded.checked_at, error = NULL",
        ).run(
          url,
          fresh.revision,
          response.headers.get("etag"),
          JSON.stringify(fresh),
          now(),
          now(),
        );
        db.prepare("DELETE FROM community_media").run();
        library().syncPublished(fresh);
      })();
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 300);
      db.prepare(
        "INSERT INTO community_cache (id, url, checked_at, error) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error, url = excluded.url, revision = CASE WHEN community_cache.url = excluded.url THEN community_cache.revision ELSE NULL END, index_json = CASE WHEN community_cache.url = excluded.url THEN community_cache.index_json ELSE NULL END, etag = CASE WHEN community_cache.url = excluded.url THEN community_cache.etag ELSE NULL END, refreshed_at = CASE WHEN community_cache.url = excluded.url THEN community_cache.refreshed_at ELSE NULL END",
      ).run(url, now(), message);
    }
    return status();
  };

  const status = () => {
    const row = cacheRow();
    return {
      configured: url !== null,
      url,
      revision: row?.revision ?? null,
      refreshedAt: row?.refreshed_at ?? null,
      checkedAt: row?.checked_at ?? null,
      error: row?.error ?? null,
      contributing: index()?.contributing ?? null,
    };
  };

  const listingOrThrow = (catalogId: string) => {
    const listing = index()?.apps.find((a) => a.id === catalogId);
    if (!listing)
      throw new LibraryError(
        "not_found",
        `${catalogId} is not in the Community catalog. Refresh and try again.`,
      );
    return listing;
  };

  const fetchPackage = async (listing: CatalogListing, version?: string) => {
    const blocked = conflicts(listing);
    const available = listing.versions.filter(
      (v) => !v.delisted && !blocked.has(v.version),
    );
    const entry = version
      ? listing.versions.find((v) => v.version === version)
      : [...available]
          .sort((a, b) => compareVersions(a.version, b.version))
          .at(-1);
    if (!entry)
      throw new LibraryError(
        "not_found",
        `${listing.id} has no installable version${version ? ` ${version}` : ""}.`,
      );
    if (blocked.has(entry.version))
      throw new LibraryError(
        "conflict",
        `${listing.id} ${entry.version} changed after it was published. It cannot be installed.`,
      );
    if (entry.delisted || listing.delisted)
      throw new LibraryError(
        "invalid",
        `${listing.id} ${entry.version} has been delisted.`,
      );
    if (entry.bytes > MAX_PACKAGE_BYTES)
      throw new LibraryError(
        "invalid",
        "This package is larger than the library limit.",
      );
    const location = resolvePath(entry.path);
    const { body } = await fetchLimited(
      location.target,
      entry.bytes,
      location.scope,
    );
    if (body.byteLength !== entry.bytes)
      throw new LibraryError(
        "invalid",
        "The downloaded package size does not match the catalog. Nothing was installed.",
      );
    const text = body.toString("utf8");
    if (Buffer.byteLength(text, "utf8") !== body.byteLength)
      throw new LibraryError(
        "invalid",
        "The downloaded package is not valid UTF-8. Nothing was installed.",
      );
    const digest = createHash("sha256").update(body).digest("hex");
    if (digest !== entry.digest)
      throw new LibraryError(
        "invalid",
        "The downloaded package does not match the catalog's digest. Nothing was installed.",
      );
    const { pkg } = parsePackage(text);
    if (pkg.version !== entry.version)
      throw new LibraryError(
        "invalid",
        "The package's version does not match the catalog entry. Nothing was installed.",
      );
    return { entry, text, pkg };
  };

  const view: CatalogView = {
    configured: () => url !== null,
    revision: () => cacheRow()?.revision ?? null,
    contributing: () => index()?.contributing ?? null,
    listing: (catalogId) =>
      index()?.apps.find((a) => a.id === catalogId) ?? null,
  };

  return {
    view,
    setUrl(next: string | undefined) {
      url = next ? catalogBase(next).href : null;
    },
    refresh,
    status,
    async list({
      query,
      refreshIfStale = false,
    }: {
      query?: string;
      refreshIfStale?: boolean;
    }) {
      const current = status();
      if (
        refreshIfStale &&
        current.configured &&
        (!current.checkedAt || now() - current.checkedAt > STALE_MS)
      )
        await refresh();
      const installs = library().catalogInstalls();
      const q = (query ?? "").trim().toLowerCase();
      const apps = (index()?.apps ?? [])
        .filter(
          (a) =>
            !q ||
            `${a.title} ${a.summary} ${a.author.name}`
              .toLowerCase()
              .includes(q),
        )
        .map((listing) => {
          const blocked = conflicts(listing);
          const live = listing.versions.filter(
            (v) => !v.delisted && !blocked.has(v.version),
          );
          const latest =
            [...live]
              .sort((a, b) => compareVersions(a.version, b.version))
              .at(-1) ?? null;
          const mine = installs.filter((i) => i.catalog_id === listing.id);
          const selected = mine[0]?.selected ?? null;
          return {
            id: listing.id,
            title: listing.title,
            summary: listing.summary,
            author: listing.author,
            license: listing.license,
            agentActions: listing.agentActions,
            hasPreview: !!listing.preview || !!listing.screenshots?.length,
            screenshots: (listing.screenshots ?? []).map((shot) => ({
              alt: shot.alt,
            })),
            delisted: !!listing.delisted || !latest,
            latest: latest
              ? {
                  version: latest.version,
                  notes: latest.notes ?? null,
                  bytes: latest.bytes,
                }
              : null,
            versions: listing.versions.map((v) => ({
              version: v.version,
              notes: v.notes ?? null,
              delisted: !!v.delisted,
              changed: blocked.has(v.version),
            })),
            installed: mine.length
              ? {
                  appId: mine[0]!.app_id,
                  trashed: mine[0]!.trashed_at !== null,
                  versions: mine.map((i) => i.label),
                  selected,
                  selectedDelisted:
                    listing.versions.some(
                      (v) => v.version === selected && v.delisted,
                    ) || !!listing.delisted,
                }
              : null,
            updateAvailable: !!(
              latest &&
              selected &&
              compareVersions(latest.version, selected) > 0
            ),
            authoredAppId: library().authoredListing(listing.id),
          };
        });
      return { ...status(), apps };
    },
    async inspect({
      catalogId,
      version,
    }: {
      catalogId: string;
      version?: string;
    }) {
      const listing = listingOrThrow(catalogId);
      const { entry, pkg } = await fetchPackage(listing, version);
      return {
        id: listing.id,
        version: entry.version,
        digest: entry.digest,
        bytes: entry.bytes,
        notes: entry.notes ?? null,
        title: pkg.title,
        summary: pkg.summary,
        contentKind: pkg.content.kind,
        actions: pkg.actions,
        author: pkg.author ?? listing.author,
        license: pkg.license ?? listing.license,
        origin: pkg.origin ?? null,
        source: url ? resolvePath(entry.path).target.href : null,
      };
    },
    async add({
      catalogId,
      version,
      requestId,
    }: {
      catalogId: string;
      version?: string;
      requestId?: string;
    }) {
      const listing = listingOrThrow(catalogId);
      const { text } = await fetchPackage(listing, version);
      return library().addCatalogVersion({
        catalogId,
        text,
        name: listing.title,
        description: listing.summary,
        select: true,
        ...(requestId ? { requestId } : {}),
      });
    },
    async preview(catalogId: string, index: number | null) {
      const listing = listingOrThrow(catalogId);
      const shot = index === null ? undefined : listing.screenshots?.[index];
      if (index !== null && !shot) return null;
      const path = shot?.path ?? listing.preview;
      if (!path) return null;
      const cached = db
        .prepare(
          "SELECT type, data FROM community_media WHERE catalog_id = ? AND path = ?",
        )
        .get(catalogId, path) as { type: string; data: Buffer } | undefined;
      if (cached) return cached;
      const location = resolvePath(path);
      const { body } = await fetchLimited(
        location.target,
        shot ? shot.bytes : MAX_PREVIEW_BYTES,
        location.scope,
      );
      if (
        shot &&
        (body.byteLength !== shot.bytes ||
          createHash("sha256").update(body).digest("hex") !== shot.digest)
      )
        return null;
      const image = readImage(body);
      if (!image) return null;
      db.prepare(
        "INSERT OR REPLACE INTO community_media (catalog_id, path, type, data) VALUES (?, ?, ?, ?)",
      ).run(catalogId, path, image.type, body);
      return { type: image.type, data: body };
    },
  };
}
export type Catalog = ReturnType<typeof createCatalog>;
