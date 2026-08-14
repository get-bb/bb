import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PluginMarketplaceSourceKind } from "@bb/db";
import {
  parsePluginSource,
  realPathInside,
  runInstallCommand,
} from "../plugins/install-sources.js";
import {
  boundedResponseBytes,
  MARKETPLACE_FETCH_TIMEOUT_MS,
  type MarketplaceFetch,
} from "./marketplace-http.js";
import {
  parseMarketplaceManifest,
  parseMarketplaceManifestJson,
  type MarketplaceIconBase,
  type MarketplaceManifest,
} from "./marketplace-manifest.js";

/** File a git or path marketplace keeps its manifest in. */
const MARKETPLACE_MANIFEST_FILENAME = "marketplace.json";

export const MARKETPLACE_MANIFEST_MAX_BYTES = 1_048_576;

/** Where a marketplace's manifest is read from. */
type MarketplaceSource =
  | { kind: "https"; manifestUrl: string }
  | { kind: "git"; url: string; ref: string }
  | { kind: "path"; directory: string };

const GIT_CLONE_ARGS = ["-c", "core.hooksPath=/dev/null"] as const;

const SOURCE_FORMS =
  'expected "https://<manifest-url>", "git:<url>[@<ref>]", or "path:<directory>"';

/**
 * Parse a `bb marketplace add` source. The three forms are explicit on
 * purpose: a marketplace is a trust decision, so bb never guesses whether a
 * bare string meant a repository, a directory, or a URL.
 */
export function parseMarketplaceSource(raw: string): MarketplaceSource {
  const source = raw.trim();
  if (source.length === 0) {
    throw new Error(`invalid marketplace source: ${SOURCE_FORMS}`);
  }
  if (source.startsWith("path:")) {
    const directory = source.slice("path:".length);
    if (directory.length === 0) {
      throw new Error("marketplace source has an empty path");
    }
    return { kind: "path", directory: resolve(directory) };
  }
  if (source.startsWith("git:")) {
    const parsed = parsePluginSource(source);
    if (parsed.kind !== "git") {
      throw new Error(`invalid marketplace git source "${source}"`);
    }
    // A marketplace has no release tags to range over, and a spec that could
    // read as either is refused rather than guessed.
    if (parsed.selector.kind !== "ref") {
      throw new Error(
        `invalid marketplace git source "${source}": a marketplace ref names one branch, tag, or commit`,
      );
    }
    return { kind: "git", url: parsed.url, ref: parsed.selector.ref };
  }
  if (/^https:\/\//iu.test(source)) {
    return { kind: "https", manifestUrl: source };
  }
  if (/^http:\/\//iu.test(source)) {
    throw new Error(
      `invalid marketplace source "${source}": plain http is refused, use https`,
    );
  }
  throw new Error(`invalid marketplace source "${source}": ${SOURCE_FORMS}`);
}

/** The canonical spec that re-adds this marketplace. */
export function marketplaceSourceDisplay(source: MarketplaceSource): string {
  if (source.kind === "https") return source.manifestUrl;
  if (source.kind === "path") return `path:${source.directory}`;
  return `git:${source.url}@${source.ref}`;
}

/** Rebuild a source from its stored columns. */
export function marketplaceSourceFromRow(row: {
  sourceKind: PluginMarketplaceSourceKind;
  manifestUrl: string;
  sourceGitRef: string | null;
}): MarketplaceSource {
  if (row.sourceKind === "https") {
    return { kind: "https", manifestUrl: row.manifestUrl };
  }
  if (row.sourceKind === "path") {
    return { kind: "path", directory: row.manifestUrl };
  }
  if (row.sourceGitRef === null) {
    throw new Error("git marketplace row has no ref");
  }
  return { kind: "git", url: row.manifestUrl, ref: row.sourceGitRef };
}

/** Columns a source writes back to its marketplace row. */
export function marketplaceSourceColumns(source: MarketplaceSource): {
  sourceKind: PluginMarketplaceSourceKind;
  manifestUrl: string;
  sourceGitRef: string | null;
} {
  if (source.kind === "https") {
    return {
      sourceKind: "https",
      manifestUrl: source.manifestUrl,
      sourceGitRef: null,
    };
  }
  if (source.kind === "path") {
    return {
      sourceKind: "path",
      manifestUrl: source.directory,
      sourceGitRef: null,
    };
  }
  return {
    sourceKind: "git",
    manifestUrl: source.url,
    sourceGitRef: source.ref,
  };
}

interface MaterializedMarketplace {
  catalog: MarketplaceManifest;
  /** Canonical JSON of `catalog`, ready to store. */
  manifestJson: string;
  /** True when a conditional request said the stored document still applies. */
  unchanged: boolean;
  etag: string | null;
  lastModified: string | null;
  /** Commit a git checkout was read at; null for the other kinds. */
  commit: string | null;
  /** Where this marketplace's relative icons come from. */
  iconBase: MarketplaceIconBase;
  /** Remove the temporary checkout, if any. Always call it. */
  dispose(): Promise<void>;
}

/**
 * Read a marketplace's manifest without installing or running anything.
 *
 * An https marketplace replays its stored ETag/Last-Modified so an unchanged
 * catalog costs one 304. A git marketplace is cloned into a throwaway staging
 * directory, read, and deleted: everything bb keeps — the manifest and the
 * icon bytes — is already in SQLite, so no checkout has to survive. A path
 * marketplace is read in place.
 */
export async function materializeMarketplace(args: {
  source: MarketplaceSource;
  /** Stored document and validators; null forces a full read. */
  cached: {
    manifestJson: string;
    etag: string | null;
    lastModified: string | null;
  } | null;
  /** Parent directory for git staging checkouts. */
  stagingDir: string;
  fetch: MarketplaceFetch;
}): Promise<MaterializedMarketplace> {
  if (args.source.kind === "https") {
    return materializeHttps(args.source, args.cached, args.fetch);
  }
  if (args.source.kind === "path") {
    return materializeLocal(args.source.directory, null, async () => {});
  }
  return materializeGit(args.source, args.stagingDir);
}

async function materializeHttps(
  source: Extract<MarketplaceSource, { kind: "https" }>,
  cached: {
    manifestJson: string;
    etag: string | null;
    lastModified: string | null;
  } | null,
  fetchMarketplace: MarketplaceFetch,
): Promise<MaterializedMarketplace> {
  const headers = new Headers({ accept: "application/json" });
  if (cached?.etag != null) headers.set("if-none-match", cached.etag);
  if (cached?.lastModified != null) {
    headers.set("if-modified-since", cached.lastModified);
  }
  const response = await fetchMarketplace(source.manifestUrl, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(MARKETPLACE_FETCH_TIMEOUT_MS),
  });
  const unchanged = response.status === 304 && cached !== null;
  if (!unchanged && !response.ok) {
    await response.body?.cancel();
    throw new Error(`request failed with HTTP ${response.status}`);
  }
  let manifestJson: string;
  let catalog: MarketplaceManifest;
  if (unchanged) {
    await response.body?.cancel();
    manifestJson = cached.manifestJson;
    catalog = parseMarketplaceManifestJson(
      manifestJson,
      "stored marketplace catalog",
    );
  } else {
    const raw = new TextDecoder().decode(
      await boundedResponseBytes(
        response,
        MARKETPLACE_MANIFEST_MAX_BYTES,
        "marketplace manifest",
      ),
    );
    catalog = parseMarketplaceManifestJson(raw, "marketplace manifest");
    manifestJson = JSON.stringify(catalog);
  }
  return {
    catalog,
    manifestJson,
    unchanged,
    etag: response.headers.get("etag") ?? (unchanged ? cached.etag : null),
    lastModified:
      response.headers.get("last-modified") ??
      (unchanged ? cached.lastModified : null),
    commit: null,
    iconBase: { kind: "url", manifestUrl: source.manifestUrl },
    dispose: async () => {},
  };
}

async function materializeLocal(
  root: string,
  commit: string | null,
  dispose: () => Promise<void>,
): Promise<MaterializedMarketplace> {
  try {
    const isDirectory = await stat(root)
      .then((entry) => entry.isDirectory())
      .catch(() => false);
    if (!isDirectory) {
      throw new Error(`marketplace directory does not exist: ${root}`);
    }
    const manifestPath = await realPathInside(
      root,
      join(root, MARKETPLACE_MANIFEST_FILENAME),
      "marketplace manifest",
    );
    // Size first, then read: an oversize manifest is refused before it is
    // loaded, the same bound an https manifest gets from its content-length.
    const manifestSize = (await stat(manifestPath)).size;
    if (manifestSize > MARKETPLACE_MANIFEST_MAX_BYTES) {
      throw new Error(
        `marketplace manifest exceeds ${MARKETPLACE_MANIFEST_MAX_BYTES} bytes`,
      );
    }
    const raw = await readFile(manifestPath, "utf8");
    const catalog = parseMarketplaceManifest(
      JSON.parse(raw) as unknown,
      "marketplace manifest",
    );
    return {
      catalog,
      manifestJson: JSON.stringify(catalog),
      unchanged: false,
      etag: null,
      lastModified: null,
      commit,
      iconBase: { kind: "dir", root },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

async function materializeGit(
  source: Extract<MarketplaceSource, { kind: "git" }>,
  stagingDir: string,
): Promise<MaterializedMarketplace> {
  await mkdir(stagingDir, { recursive: true });
  const checkout = join(stagingDir, randomUUID());
  const dispose = () => rm(checkout, { recursive: true, force: true });
  try {
    await runInstallCommand("git", [
      ...GIT_CLONE_ARGS,
      "clone",
      "--quiet",
      "--no-checkout",
      source.url,
      checkout,
    ]);
    await runInstallCommand("git", [
      ...GIT_CLONE_ARGS,
      "-C",
      checkout,
      "checkout",
      "--quiet",
      "--detach",
      source.ref,
    ]);
    const commit = await runInstallCommand("git", [
      "-C",
      checkout,
      "rev-parse",
      "HEAD",
    ]);
    // The checkout is only a manifest carrier. Dropping .git first keeps a
    // hostile repository from smuggling hooks or config into the icon read.
    await rm(join(checkout, ".git"), { recursive: true, force: true });
    return await materializeLocal(checkout, commit, dispose);
  } catch (error) {
    await dispose();
    throw error;
  }
}
