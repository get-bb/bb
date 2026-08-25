import { z } from "zod";
import {
  boundedResponseBytes,
  MARKETPLACE_FETCH_TIMEOUT_MS,
  type MarketplaceFetch,
} from "./marketplace-http.js";

/** Sidecar the curated marketplace publishes beside its manifest. */
const MARKETPLACE_STATS_FILENAME = "stats.json";

/** One id plus one integer per entry; this only bounds a hostile response. */
const MARKETPLACE_STATS_MAX_BYTES = 512 * 1024;

/** Same id shape the manifest requires of an entry. */
const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

/**
 * The install-count sidecar.
 *
 * Deliberately not a strict schema, unlike the manifest. The manifest is a
 * security contract, so an unknown field there rejects the document; this file
 * is display metadata that a later publisher may extend, and a store that lost
 * its counts because a new field appeared would be worse than one that ignores
 * the field. A malformed document is still rejected whole: half-parsed counts
 * are worse than none.
 */
const marketplaceStatsSchema = z.object({
  schemaVersion: z.literal(1),
  /** When the publisher ran the query, ISO 8601. Recorded, not displayed. */
  generatedAt: z.string(),
  plugins: z.record(
    z.string(),
    z.object({ installs: z.number().int().nonnegative() }),
  ),
});

export type MarketplaceStats = z.infer<typeof marketplaceStatsSchema>;

export function parseMarketplaceStatsJson(
  raw: string,
  location: string,
): MarketplaceStats {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `invalid ${location}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const parsed = marketplaceStatsSchema.safeParse(document);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    throw new Error(
      `invalid ${location}: ${issue === undefined ? "unexpected shape" : `${issue.path.join(".") || "/"} ${issue.message}`}`,
    );
  }
  // An id outside the manifest's own id shape can never match an entry, so it
  // is dropped here rather than kept as a row nothing will ever read.
  return {
    ...parsed.data,
    plugins: Object.fromEntries(
      Object.entries(parsed.data.plugins).filter(([id]) =>
        ENTRY_ID_PATTERN.test(id),
      ),
    ),
  };
}

/** Install counts by entry id, or an empty map when there is no sidecar. */
export function installCountsFromStatsJson(
  statsJson: string | null,
  onInvalid?: (message: string) => void,
): ReadonlyMap<string, number> {
  if (statsJson === null) return new Map();
  try {
    const stats = parseMarketplaceStatsJson(statsJson, "stored install counts");
    return new Map(
      Object.entries(stats.plugins).map(([id, entry]) => [id, entry.installs]),
    );
  } catch (error) {
    onInvalid?.(error instanceof Error ? error.message : String(error));
    return new Map();
  }
}

/** Where the sidecar of an https marketplace lives: beside its manifest. */
export function marketplaceStatsUrl(manifestUrl: string): string {
  return new URL(MARKETPLACE_STATS_FILENAME, manifestUrl).toString();
}

/**
 * Fetch the install-count sidecar of the curated marketplace.
 *
 * Unconditional on purpose: the counts move while the manifest sits unchanged
 * behind a 304, so replaying the manifest's validators here would freeze them.
 * A missing file (404) is normal — a marketplace need not publish counts —
 * and answers null, as does any failure. The caller keeps the counts it
 * already had; a store must not lose its catalog over a cosmetic number.
 */
export async function fetchMarketplaceStats(args: {
  manifestUrl: string;
  fetch: MarketplaceFetch;
}): Promise<MarketplaceStats | null> {
  const url = marketplaceStatsUrl(args.manifestUrl);
  const response = await args.fetch(url, {
    method: "GET",
    headers: new Headers({ accept: "application/json" }),
    redirect: "error",
    signal: AbortSignal.timeout(MARKETPLACE_FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`request failed with HTTP ${response.status}`);
  }
  const raw = new TextDecoder().decode(
    await boundedResponseBytes(
      response,
      MARKETPLACE_STATS_MAX_BYTES,
      "marketplace install counts",
    ),
  );
  return parseMarketplaceStatsJson(raw, "marketplace install counts");
}
