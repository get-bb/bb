import type Database from "better-sqlite3";
import type {
  PlatformClient,
  RemoteService,
} from "../../../lib/remote/types.js";

export type SbomSeverity = "critical" | "high" | "medium" | "low";
export type SbomReachability =
  | "reachable"
  | "unreachable"
  | "mixed"
  | "unknown";

export interface SbomPullInput {
  projectId: string;
  projectVersionId: string;
  resume?: boolean;
}

export interface SbomPullResult {
  projectVersionId: string;
  /** Remote component rows fetched during this invocation. */
  fetched: number;
  components: number;
  /** Generation-total rows isolated because no stable identity could be derived. */
  quarantined: number;
  /** Generation-total quarantine counts keyed only by safe reason code. */
  quarantineReasons: Readonly<Record<string, number>>;
  pages: number;
  rollups: number;
  pulledAt: string;
  resumed: boolean;
}

export interface SbomQuery {
  projectVersionId: string;
  cursor?: string;
  limit?: number;
  search?: string;
  purl?: string;
  license?: string;
  minimumSeverity?: SbomSeverity;
  kev?: boolean;
  reachability?: SbomReachability;
  componentKey?: string;
}

export interface SbomComponentSummary {
  componentKey: string;
  purl: string | null;
  cpe: string | null;
  name: string;
  group: string | null;
  version: string | null;
  license: string | null;
  supplier: string | null;
  source: string | null;
  isStale: boolean;
  files: string[];
  vuln: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    kev: number;
    maxEpss: number | null;
    reachability: SbomReachability;
  };
  pulledAt: string;
}

export interface SbomCacheState {
  state: "fresh" | "stale" | "empty";
  asOf: string | null;
  message: string | null;
  acceptedGenerationId: string | null;
  baseRevision: number;
}

export interface SbomPage<T> {
  items: T[];
  total: number;
  cursor: string | null;
  cache: SbomCacheState;
}

export interface BomDeps {
  db: Database.Database;
  platform: Pick<PlatformClient, "listComponents">;
  /** Verified plugin-data root. Staging is confined to .fs-sync/bom below it. */
  stagingRoot: string;
  /** Existing sync-engine generation whose final publication fence is external. */
  generationId: string;
  signal?: AbortSignal;
  pageSize?: number;
  now?: () => Date;
  publishProgress?: (hint: {
    projectVersionId: string;
    components: number;
    pages: number;
  }) => void;
  warn?: (
    message: string,
    details: { count: number; projectVersionId: string },
  ) => void;
}

export class SbomPullError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly service: RemoteService = "platform",
  ) {
    super(message);
    this.name = "SbomPullError";
  }
}

export class SbomQueryError extends Error {
  constructor(
    readonly code: "BAD_CURSOR",
    message: string,
  ) {
    super(message);
    this.name = "SbomQueryError";
  }
}
