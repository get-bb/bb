import type Database from "better-sqlite3";
import type { Json, PlatformClient } from "../../../lib/remote/types.js";

/**
 * Projection map for the frozen findings table. Platform aliases are accepted
 * only by pull.ts; all remaining findings code uses these explicit cache names.
 */
export interface CachedFinding {
  projectId: string;
  projectVersionId: string;
  generationId: string;
  findingId: string;
  stableKey: string;
  findingType: string | null;
  cve: string | null;
  title: string | null;
  componentName: string | null;
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
  inKev: boolean;
  inVcKev: boolean;
  hasExploit: boolean;
  exploitMaturity: string | null;
  reachabilityScore: number | null;
  reachabilityVerdict: string | null;
  reachabilityFactors: Json;
  vulnInDataset: boolean | null;
  cwes: string[];
  warningCount: number;
  violationCount: number;
  location: Json;
  vexStatus: string | null;
  vexResponse: string | null;
  vexJustification: string | null;
  vexReason: string | null;
  comments: CachedComment[];
  firstSeen: string | null;
  softDeleted: boolean;
  raw: Record<string, Json>;
  pulledAt: string;
  localState: "none" | "local" | "conflicted" | "stale" | "needs_completion";
  localFile: string | null;
}

export interface CachedActivity {
  projectId: string;
  projectVersionId: string;
  findingId: string;
  eventId: string;
  stableKey: string;
  actor: string | null;
  eventAt: string;
  source: string | null;
  oldTuple: Json;
  newTuple: Json;
  raw: Record<string, Json>;
  pulledAt: string;
}

export interface CachedComment {
  id: string;
  findingId: string;
  actorLabel: string | null;
  text: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface FindingsDeps {
  db: Database.Database;
  platform: Pick<PlatformClient, "getFindings">;
  pageSize?: number;
  warn?: (
    message: string,
    details: { count: number; projectVersionId: string },
  ) => void;
}

export interface FindingsFilter {
  projectId: string;
  pvId: string;
  severity?: string[];
  reachability?: "reachable" | "unreachable" | "unknown";
  kev?: "kev" | "vc-kev" | "none";
  epssGte?: number;
  component?: string;
  cve?: string;
  triage?: string[];
  findingType?: string[];
  hasLocalChange?: boolean;
  localState?: Array<
    "none" | "local" | "conflicted" | "stale" | "needs_completion"
  >;
  cursor?: string;
  limit?: number;
}

export interface CacheMetadata {
  state: "fresh" | "stale" | "empty";
  asOf: string | null;
  message: string | null;
  acceptedGenerationId: string | null;
  baseRevision: number;
}

export interface FindingsPage {
  items: CachedFinding[];
  total: number;
  nextCursor: string | null;
  facets: Record<string, Record<string, number>>;
  cache: CacheMetadata;
}

export interface PullProgress {
  page: number;
  of: number | null;
  phase: "fetch" | "write" | "done" | "error";
}

export interface PullFindingsResult {
  /** Rows fetched and staged by this invocation, excluding reused staging. */
  fetched: number;
  /** Complete row count in the generation that is ready to publish. */
  published: number;
  pages: number;
  pulledAt: string;
  deduplicated: number;
}

export class FindingsCacheError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FindingsCacheError";
  }
}
