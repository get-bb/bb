import type Database from "better-sqlite3";

import {
  findingStableKey,
  parseFindingStableKey,
  type FindingIdentity,
  type FindingKeyTier,
  type ParsedFindingStableKey,
} from "../../../lib/sync/registry.js";
import { findingFromRow } from "../cache/query.js";
import type { CachedFinding } from "../cache/types.js";
import {
  foldFindingComponent,
  foldFindingGroup,
  normalizeFindingPurl,
  normalizeFindingVersion,
} from "./fold.js";

const MAX_ENCODED_STABLE_KEY_LENGTH = 512;
const CODE_NOT_REACHABLE = "CODE_NOT_REACHABLE";

type FindingRow = Parameters<typeof findingFromRow>[0];

export interface StableFindingKey extends FindingIdentity {
  schema: "fs-finding-key/v1";
  project: string;
  purl: string | null;
  group: string | null;
  version: string | null;
}

export type Pin = "exact_version" | "any_version";

export type FindingMatchReason =
  | "purl_cve"
  | "folded_name_group_version_cve"
  | "folded_name_group_cve";

export type FindingResolution =
  | {
    state: "resolved";
    tier: 1 | 2 | 3;
    reason: FindingMatchReason;
    rows: CachedFinding[];
    versionChanged: boolean;
  }
  | { state: "stale"; reason: "exact_version_changed"; candidates: CachedFinding[] }
  | { state: "orphaned"; reason: "no_component_cve_match" };

export class StableFindingKeyError extends Error {
  readonly code = "INVALID_STABLE_KEY" as const;

  constructor(message: string) {
    super(message);
    this.name = "StableFindingKeyError";
  }
}

export class FindingPinError extends Error {
  readonly code = "INVALID_PIN" as const;

  constructor(message: string) {
    super(message);
    this.name = "FindingPinError";
  }
}

export function enforcePin(input: { pin?: Pin; justification?: string | null }): Pin {
  if (input.justification === CODE_NOT_REACHABLE) {
    if (input.pin === "any_version") {
      throw new FindingPinError("CODE_NOT_REACHABLE decisions cannot use any_version");
    }
    return "exact_version";
  }
  return input.pin ?? "exact_version";
}

/** Validates an untrusted route/RPC key through the frozen codec before any query is prepared. */
export function parseEncodedFindingKey(encoded: string): ParsedFindingStableKey {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_STABLE_KEY_LENGTH) {
    throw new StableFindingKeyError("Finding stable key must contain between 1 and 512 characters");
  }
  try {
    return parseFindingStableKey(encoded);
  } catch {
    throw new StableFindingKeyError("Finding stable key is malformed");
  }
}

function validateKey(key: StableFindingKey): void {
  if (key.schema !== "fs-finding-key/v1") {
    throw new StableFindingKeyError("Unsupported finding stable-key schema");
  }
  if (key.project.normalize("NFC").trim().length === 0) {
    throw new StableFindingKeyError("Finding stable key project must not be empty");
  }
  const group = foldFindingGroup(key.group);
  const identity: Readonly<Record<string, unknown>> & FindingIdentity = {
    cve: key.cve,
    purl: key.purl,
    name: key.name,
    group,
    version: key.version,
  };
  const tier: FindingKeyTier = key.purl !== null
    ? "purl"
    : key.version !== null
      ? "name-group-version"
      : "name-group-any-version";
  try {
    // The frozen codec remains the sole authority for accepted identity values.
    parseFindingStableKey(findingStableKey(identity, tier));
  } catch {
    throw new StableFindingKeyError("Finding stable key identity is invalid");
  }
}

const SELECT_ACCEPTED_FINDINGS = `
  SELECT f.*
    FROM findings f
    JOIN sync_state s
      ON s.project_id = f.project_id
     AND s.project_version_id = f.project_version_id
     AND s.entity_kind = 'finding'
     AND s.accepted_generation_id = f.generation_id
   WHERE f.project_id = ?
     AND f.project_version_id = ?
     AND f.cve = ?
     AND f.soft_deleted = 0`;

function rowsFromBoundary(rows: unknown[]): CachedFinding[] {
  // better-sqlite3 is the untyped storage boundary. The fixed SELECT projection
  // is the frozen findings table consumed by findingFromRow.
  return (rows as FindingRow[]).map(findingFromRow);
}

function purlRows(
  db: Database.Database,
  project: string,
  pvId: string,
  cve: string,
  purl: string,
): CachedFinding[] {
  return rowsFromBoundary(db.prepare(
    `${SELECT_ACCEPTED_FINDINGS}
       AND f.component_purl = ?
     ORDER BY f.finding_id ASC`,
  ).all(project, pvId, cve, purl));
}

function nameGroupRows(
  db: Database.Database,
  key: StableFindingKey,
  pvId: string,
): CachedFinding[] {
  const foldedName = foldFindingComponent(key.name);
  const foldedGroup = foldFindingGroup(key.group);
  const candidates = rowsFromBoundary(db.prepare(
    `${SELECT_ACCEPTED_FINDINGS}
       AND f.component_name IS NOT NULL
     ORDER BY f.finding_id ASC`,
  ).all(key.project, pvId, key.cve));
  return candidates.filter(row =>
    row.componentName !== null
    && foldFindingComponent(row.componentName) === foldedName
    && foldFindingGroup(row.componentGroup) === foldedGroup
  );
}

function versionChanged(rows: readonly CachedFinding[], version: string | null): boolean {
  return rows.some(row => normalizeFindingVersion(row.componentVersion) !== version);
}

/** Resolves a full authored identity against the accepted, read-only findings generation. */
export function resolveFinding(
  db: Database.Database,
  key: StableFindingKey,
  pvId: string,
  pin: Pin,
): FindingResolution {
  validateKey(key);
  const purl = normalizeFindingPurl(key.purl);
  const version = normalizeFindingVersion(key.version);

  if (purl !== null) {
    const rows = purlRows(db, key.project, pvId, key.cve, purl);
    if (rows.length > 0) {
      return { state: "resolved", tier: 1, reason: "purl_cve", rows, versionChanged: versionChanged(rows, version) };
    }
  }

  const ngRows = nameGroupRows(db, key, pvId);
  if (version !== null) {
    const rows = ngRows.filter(row => normalizeFindingVersion(row.componentVersion) === version);
    if (rows.length > 0) {
      return {
        state: "resolved",
        tier: 2,
        reason: "folded_name_group_version_cve",
        rows,
        versionChanged: false,
      };
    }
  }

  if (pin === "any_version" && ngRows.length > 0) {
    return {
      state: "resolved",
      tier: 3,
      reason: "folded_name_group_cve",
      rows: ngRows,
      versionChanged: versionChanged(ngRows, version),
    };
  }

  if (pin === "exact_version") {
    const changed = ngRows.filter(row => normalizeFindingVersion(row.componentVersion) !== version);
    if (changed.length > 0) {
      return { state: "stale", reason: "exact_version_changed", candidates: changed };
    }
  }

  return { state: "orphaned", reason: "no_component_cve_match" };
}

/**
 * Resolves callers that only possess the frozen opaque key. The frozen NVG
 * codec case-folds versions, so this compatibility path necessarily compares
 * that folded decoded value. Full-domain resolution above is authoritative
 * whenever exact version case or purl-to-NVG fallback matters.
 */
export function resolveEncodedFinding(
  db: Database.Database,
  encoded: string,
  project: string,
  pvId: string,
): FindingResolution {
  const parsed = parseEncodedFindingKey(encoded);
  if (parsed.tier === "purl") {
    if (!("purl" in parsed.component)) {
      throw new StableFindingKeyError("Finding stable key has inconsistent purl identity");
    }
    const rows = purlRows(db, project, pvId, parsed.cve, parsed.component.purl);
    return rows.length > 0
      ? { state: "resolved", tier: 1, reason: "purl_cve", rows, versionChanged: false }
      : { state: "orphaned", reason: "no_component_cve_match" };
  }

  if (!("name" in parsed.component)) {
    throw new StableFindingKeyError("Finding stable key has inconsistent fallback identity");
  }

  const key: StableFindingKey = {
    schema: "fs-finding-key/v1",
    project,
    purl: null,
    name: parsed.component.name,
    group: parsed.component.group,
    version: parsed.component.version,
    cve: parsed.cve,
  };
  return resolveFinding(
    db,
    key,
    pvId,
    parsed.tier === "name-group-any-version" ? "any_version" : "exact_version",
  );
}
