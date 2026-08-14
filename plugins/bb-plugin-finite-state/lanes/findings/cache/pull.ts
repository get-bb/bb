import type { Json, RemotePage } from "../../../lib/remote/types.js";
import type { SyncScope } from "../../sync/engine/adapter.js";
import { TerminalPullError } from "../../sync/engine/pull.js";
import {
  FindingsCacheError,
  type FindingsDeps,
  type PullFindingsResult,
  type PullProgress,
} from "./types.js";
import {
  canonicalFindingStableKey,
  canonicalizeFindingIdentity,
  selectFindingCve,
} from "../stable-key/canonical.js";
import { purlIdentity } from "../stable-key/wire-identity.js";

const ENTITY_KIND = "finding";
const DEFAULT_PAGE_SIZE = 200;

interface NormalizedFinding {
  findingId: string;
  stableKey: string;
  findingType: string | null;
  cve: string;
  title: string | null;
  componentName: string;
  componentGroup: string | null;
  componentVersion: string | null;
  componentPurl: string | null;
  severity: string | null;
  riskScore: number | null;
  band: string | null;
  cvssScore: number | null;
  cvssVector: string | null;
  epssScore: number | null;
  epssPercentile: number | null;
  inKev: number;
  inVcKev: number;
  hasExploit: number;
  exploitMaturity: string | null;
  reachabilityScore: number | null;
  reachabilityVerdict: string | null;
  reachabilityFactors: string;
  vulnInDataset: number | null;
  cwes: string[];
  warningCount: number;
  violationCount: number;
  location: string;
  vexStatus: string | null;
  vexResponse: string | null;
  vexJustification: string | null;
  vexReason: string | null;
  comments: string;
  firstSeen: string | null;
  softDeleted: number;
  raw: string;
}

function record(value: Json): Record<string, Json> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function stringValue(
  row: Record<string, Json>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      const normalized = value.normalize("NFC").trim();
      if (normalized) return normalized;
    }
  }
  return null;
}

function requiredString(
  row: Record<string, Json>,
  keys: readonly string[],
  label: string,
): string {
  const value = stringValue(row, keys);
  if (value === null)
    throw new FindingsCacheError(
      "FINDING_INVALID_ROW",
      `Finding ${label} is missing`,
    );
  return value;
}

function numberValue(
  row: Record<string, Json>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function booleanValue(
  row: Record<string, Json>,
  keys: readonly string[],
): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value === 1) return 1;
    if (value === 0) return 0;
  }
  return 0;
}

function nullableBoolean(
  row: Record<string, Json>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value === 1) return 1;
    if (value === 0) return 0;
  }
  return null;
}

function jsonArray(row: Record<string, Json>, keys: readonly string[]): Json[] {
  for (const key of keys)
    if (Array.isArray(row[key])) return row[key] as Json[];
  return [];
}

function cwes(row: Record<string, Json>): string[] {
  const values = jsonArray(row, ["cwes", "cwe"]);
  const result = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.trim())
      result.add(value.normalize("NFC").trim());
    const item = record(value);
    const id = item ? stringValue(item, ["id", "cwe", "name"]) : null;
    if (id) result.add(id);
  }
  return [...result].sort((left, right) => left.localeCompare(right));
}

function jsonField(
  row: Record<string, Json>,
  keys: readonly string[],
  fallback: Json,
): string {
  for (const key of keys)
    if (row[key] !== undefined) return JSON.stringify(row[key]);
  return JSON.stringify(fallback);
}

function payloadKeyDetail(
  row: Record<string, Json>,
  component: Record<string, Json> | null,
): string {
  const topLevelKeys = Object.keys(row).sort().join(", ") || "none";
  const componentKeys = component
    ? Object.keys(component).sort().join(", ") || "none"
    : "none";
  return `payload keys [${topLevelKeys}]; component keys [${componentKeys}]`;
}

export function normalizeFinding(value: Json): NormalizedFinding {
  const row = record(value);
  if (!row)
    throw new FindingsCacheError(
      "FINDING_INVALID_ROW",
      "Finding row must be an object",
    );
  const findingId = requiredString(row, ["id", "findingId", "uuid"], "id");
  const cve = selectFindingCve({
    cve: stringValue(row, ["cve"]),
    findingIdentifier: stringValue(row, ["findingIdentifier"]),
    findingId: stringValue(row, ["findingId"]),
    vulnerabilityId: stringValue(row, ["vulnerabilityId"]),
  });
  if (cve === null)
    throw new FindingsCacheError(
      "FINDING_INVALID_ROW",
      `Finding ${findingId} CVE is missing`,
    );
  const component = record(row["component"] ?? null);
  const componentPurl = stringValue(row, [
    "componentPurl",
    "purl",
    "packageUrl",
  ]);
  const parsedPurl = purlIdentity(componentPurl);
  const componentName =
    stringValue(row, ["componentName", "name"]) ??
    (component ? stringValue(component, ["name"]) : null) ??
    parsedPurl?.name ??
    null;
  const componentGroup =
    stringValue(row, ["componentGroup", "group", "namespace"]) ??
    parsedPurl?.group ??
    null;
  const componentVersion =
    stringValue(row, ["componentVersion", "version"]) ??
    (component ? stringValue(component, ["version"]) : null) ??
    parsedPurl?.version ??
    null;
  if (!componentName) {
    throw new FindingsCacheError(
      "FINDING_COMPONENT_IDENTITY_MISSING",
      `Finding ${findingId} has no component name for canonical identity; ${payloadKeyDetail(row, component)}`,
    );
  }
  let stableKey: string;
  let canonicalIdentity;
  try {
    canonicalIdentity = canonicalizeFindingIdentity({
      cve,
      purl: componentPurl,
      name: componentName,
      group: componentGroup,
      version: componentVersion,
    });
    stableKey = canonicalFindingStableKey(canonicalIdentity);
  } catch {
    throw new FindingsCacheError(
      "FINDING_STABLE_KEY_INVALID",
      `Finding ${findingId} has invalid canonical identity`,
    );
  }
  const memberships = cwes(row);
  return {
    findingId,
    stableKey,
    findingType: stringValue(row, ["findingType", "type"]),
    cve,
    title: stringValue(row, ["title", "name"]),
    componentName: canonicalIdentity.name,
    componentGroup: canonicalIdentity.group,
    componentVersion: canonicalIdentity.version,
    componentPurl,
    severity: stringValue(row, ["severity"]),
    riskScore: numberValue(row, ["riskScore", "risk"]),
    band: stringValue(row, ["band", "riskBand"]),
    cvssScore: numberValue(row, ["cvssScore", "cvss"]),
    cvssVector: stringValue(row, ["cvssVector", "vector"]),
    epssScore: numberValue(row, ["epssScore", "epss"]),
    epssPercentile: numberValue(row, ["epssPercentile"]),
    inKev: booleanValue(row, ["inKev", "kev"]),
    inVcKev: booleanValue(row, ["inVcKev", "vcKev"]),
    hasExploit: booleanValue(row, ["hasExploit"]),
    exploitMaturity: stringValue(row, ["exploitMaturity"]),
    reachabilityScore: numberValue(row, ["reachabilityScore"]),
    reachabilityVerdict: stringValue(row, [
      "reachabilityVerdict",
      "reachability",
    ]),
    reachabilityFactors: jsonField(
      row,
      ["reachabilityFactors", "reachabilityEvidence"],
      [],
    ),
    vulnInDataset: nullableBoolean(row, ["vulnInDataset"]),
    cwes: memberships,
    warningCount: numberValue(row, ["warningCount"]) ?? 0,
    violationCount: numberValue(row, ["violationCount"]) ?? 0,
    location: jsonField(row, ["location", "locations"], null),
    vexStatus: stringValue(row, ["vexStatus", "status"]),
    vexResponse: stringValue(row, ["vexResponse", "response"]),
    vexJustification: stringValue(row, ["vexJustification", "justification"]),
    vexReason: stringValue(row, ["vexReason", "reason"]),
    comments: jsonField(row, ["comments", "commentSummary"], []),
    firstSeen: stringValue(row, ["firstSeen"]),
    softDeleted: booleanValue(row, ["softDeleted", "deleted"]),
    raw: JSON.stringify(row),
  };
}

function checkpoint(
  deps: FindingsDeps,
  scope: SyncScope,
  generationId: string,
): {
  pages: number;
  rows: number;
  quarantined: number;
  continuation: string | null;
  pulledAt: string;
} {
  const row = deps.db
    .prepare(
      `SELECT state.staged_pages AS pages, state.staged_rows AS rows,
            state.staged_quarantined AS quarantined,
            state.staging_continuation AS continuation,
            generation.started_at AS pulledAt
       FROM sync_state AS state
       JOIN pull_generation AS generation
         ON generation.project_id = state.project_id
        AND generation.project_version_id = state.project_version_id
        AND generation.generation_id = state.staging_generation_id
      WHERE state.project_id = ? AND state.project_version_id = ? AND state.entity_kind = ?
        AND state.staging_generation_id = ?`,
    )
    .get(scope.projectId, scope.projectVersionId, ENTITY_KIND, generationId) as
    | {
        pages: number;
        rows: number;
        quarantined: number;
        continuation: string | null;
        pulledAt: string;
      }
    | undefined;
  if (!row)
    throw new FindingsCacheError(
      "FINDING_STAGING_FENCE_MOVED",
      "Finding staging generation is unavailable",
    );
  return row;
}

function writePage(
  deps: FindingsDeps,
  scope: SyncScope,
  generationId: string,
  pageNumber: number,
  page: RemotePage<Record<string, Json>>,
  pulledAt: string,
): {
  inserted: number;
  deduplicated: number;
  quarantined: number;
  quarantineReasons: ReadonlyMap<string, number>;
} {
  const normalized: NormalizedFinding[] = [];
  let quarantined = 0;
  const quarantineReasons = new Map<string, number>();
  for (const item of page.items) {
    try {
      normalized.push(normalizeFinding(item));
    } catch (error: unknown) {
      if (!(error instanceof FindingsCacheError)) throw error;
      quarantined += 1;
      quarantineReasons.set(
        error.code,
        (quarantineReasons.get(error.code) ?? 0) + 1,
      );
    }
  }
  const unique = new Map<string, NormalizedFinding>();
  let deduplicated = 0;
  for (const item of normalized) {
    if (unique.has(item.findingId)) deduplicated += 1;
    else unique.set(item.findingId, item);
  }
  const insert = deps.db.prepare(
    `INSERT OR IGNORE INTO findings
       (project_id, project_version_id, generation_id, finding_id, stable_key,
        finding_type, cve, title, component_name, component_group, component_version,
        component_purl, severity, risk_score, band, cvss_score, cvss_vector,
        epss_score, epss_percentile, in_kev, in_vc_kev, has_exploit,
        exploit_maturity, reachability_score, reachability_verdict,
        reachability_factors, vuln_in_dataset, cwes, warning_count, violation_count,
        location, vex_status, vex_response, vex_justification, vex_reason, comments,
        first_seen, soft_deleted, raw, pulled_at)
     VALUES (${Array.from({ length: 40 }, () => "?").join(", ")})`,
  );
  const insertCwe = deps.db.prepare(
    `INSERT OR IGNORE INTO finding_cwes
       (project_id, project_version_id, generation_id, finding_id, cwe, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  deps.db.transaction(() => {
    for (const item of unique.values()) {
      const result = insert.run(
        scope.projectId,
        scope.projectVersionId,
        generationId,
        item.findingId,
        item.stableKey,
        item.findingType,
        item.cve,
        item.title,
        item.componentName,
        item.componentGroup,
        item.componentVersion,
        item.componentPurl,
        item.severity,
        item.riskScore,
        item.band,
        item.cvssScore,
        item.cvssVector,
        item.epssScore,
        item.epssPercentile,
        item.inKev,
        item.inVcKev,
        item.hasExploit,
        item.exploitMaturity,
        item.reachabilityScore,
        item.reachabilityVerdict,
        item.reachabilityFactors,
        item.vulnInDataset,
        JSON.stringify(item.cwes),
        item.warningCount,
        item.violationCount,
        item.location,
        item.vexStatus,
        item.vexResponse,
        item.vexJustification,
        item.vexReason,
        item.comments,
        item.firstSeen,
        item.softDeleted,
        item.raw,
        pulledAt,
      );
      if (result.changes === 0) {
        deduplicated += 1;
        continue;
      }
      inserted += 1;
      for (const cwe of item.cwes) {
        insertCwe.run(
          scope.projectId,
          scope.projectVersionId,
          generationId,
          item.findingId,
          cwe,
          pulledAt,
        );
      }
    }
    const updated = deps.db
      .prepare(
        `UPDATE sync_state
          SET staging_continuation = ?, staged_pages = ?,
              staged_rows = staged_rows + ?,
              staged_quarantined = staged_quarantined + ?, error = NULL
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
          AND staging_generation_id = ? AND staged_pages = ?`,
      )
      .run(
        page.next,
        pageNumber,
        inserted,
        quarantined,
        scope.projectId,
        scope.projectVersionId,
        ENTITY_KIND,
        generationId,
        pageNumber - 1,
      );
    if (updated.changes !== 1)
      throw new FindingsCacheError(
        "FINDING_STAGING_FENCE_MOVED",
        "Finding staging checkpoint moved",
      );
  })();
  return { inserted, deduplicated, quarantined, quarantineReasons };
}

const ALL_ROWS_QUARANTINED = "FINDING_ALL_ROWS_QUARANTINED";

function allRowsQuarantinedError(
  quarantined: number,
  reasons: ReadonlyMap<string, number>,
): FindingsCacheError {
  const reasonSummary =
    [...reasons.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => `${code}=${count}`)
      .join(", ") || `FINDING_PRIOR_INVOCATION_QUARANTINE=${quarantined}`;
  return new FindingsCacheError(
    ALL_ROWS_QUARANTINED,
    `${ALL_ROWS_QUARANTINED}: quarantined ${quarantined} fetched finding rows; reasons [${reasonSummary}]`,
  );
}

export async function pullFindings(
  deps: FindingsDeps,
  scope: SyncScope,
  generationId: string,
  onProgress: (progress: PullProgress) => void,
): Promise<PullFindingsResult> {
  if (scope.projectVersionId === null) {
    throw new FindingsCacheError(
      "FINDING_VERSION_REQUIRED",
      "Findings are product-version scoped",
    );
  }
  const state = checkpoint(deps, scope, generationId);
  // A resumed generation must retain one pulled_at value across every page.
  const pulledAt = state.pulledAt;
  let pages = state.pages;
  let fetched = 0;
  let staged = 0;
  let quarantined = 0;
  const quarantineReasons = new Map<string, number>();
  let deduplicated = 0;
  let latestOf: number | null = null;
  try {
    if (state.pages > 0 && state.continuation === null) {
      if (state.rows === 0 && state.quarantined > 0) {
        throw new TerminalPullError(
          allRowsQuarantinedError(state.quarantined, quarantineReasons),
        );
      }
      onProgress({ page: pages, of: pages, phase: "done" });
      return {
        fetched: 0,
        published: state.rows,
        pages,
        pulledAt,
        deduplicated,
        quarantined: state.quarantined,
      };
    }
    const iterable = deps.platform.getFindings({
      projectVersionId: scope.projectVersionId,
      page: {
        pageSize: deps.pageSize ?? DEFAULT_PAGE_SIZE,
        ...(state.continuation ? { continuation: state.continuation } : {}),
      },
    });
    for await (const page of iterable) {
      pages += 1;
      latestOf =
        page.total === null
          ? null
          : Math.ceil(page.total / (deps.pageSize ?? DEFAULT_PAGE_SIZE));
      onProgress({ page: pages, of: latestOf, phase: "fetch" });
      const written = writePage(
        deps,
        scope,
        generationId,
        pages,
        page,
        pulledAt,
      );
      fetched += page.items.length;
      staged += written.inserted;
      quarantined += written.quarantined;
      for (const [code, count] of written.quarantineReasons) {
        quarantineReasons.set(code, (quarantineReasons.get(code) ?? 0) + count);
      }
      if (written.quarantined > 0) {
        deps.quarantine?.({ count: written.quarantined });
      }
      deduplicated += written.deduplicated;
      onProgress({ page: pages, of: latestOf, phase: "write" });
    }
    if (deduplicated > 0) {
      deps.warn?.("Collapsed duplicate Platform finding ids at ingest", {
        count: deduplicated,
        projectVersionId: scope.projectVersionId,
      });
    }
    const published = state.rows + staged;
    const generationQuarantined = state.quarantined + quarantined;
    if (state.quarantined > 0) {
      quarantineReasons.set(
        "FINDING_PRIOR_INVOCATION_QUARANTINE",
        state.quarantined,
      );
    }
    if (generationQuarantined > 0 && published === 0) {
      throw new TerminalPullError(
        allRowsQuarantinedError(generationQuarantined, quarantineReasons),
      );
    }
    onProgress({ page: pages, of: latestOf, phase: "done" });
    return {
      fetched,
      published,
      pages,
      pulledAt,
      deduplicated,
      quarantined: generationQuarantined,
    };
  } catch (error: unknown) {
    onProgress({ page: pages, of: latestOf, phase: "error" });
    throw error;
  }
}
