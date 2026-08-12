import { createHash } from "node:crypto";

/**
 * Closed remote-service contracts for the Finite State plugin.
 *
 * FROZEN after WP-06 merges. Changes require the contract amendment process.
 * Transport implementations validate upstream data before producing these
 * values; callers never receive transport objects, credentials, or local paths.
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type RemoteService =
  | "platform"
  | "assurance-studio"
  | "forge-compute";

export interface RemoteCallContext {
  signal?: AbortSignal;
  requestId?: string;
}

export interface RemotePage<T> {
  items: T[];
  total: number | null;
  /** Opaque continuation token; its value never reveals upstream paging style. */
  next: string | null;
}

/** The one paging input understood by every normalized remote list method. */
export interface RemotePageRequest {
  continuation?: string;
  pageSize?: number;
}

export interface RemotePageLoadRequest {
  /** Zero-based item index in the normalized sequence, not an upstream offset/page. */
  index: number;
  pageSize: number;
  signal?: AbortSignal;
}

export interface RemotePageBatch<T> {
  items: T[];
  total: number | null;
  hasMore: boolean;
}

export interface RemotePageAdapterOptions {
  service: RemoteService;
  defaultPageSize: number;
  maxPageSize: number;
}

export interface RemoteHealth {
  configured: boolean;
  reachable: boolean;
  detail: string | null;
}

export interface RemoteErrorOptions {
  service: RemoteService;
  code: string;
  status: number | null;
  retryable: boolean;
  retryAfterMs: number | null;
  details: Json | null;
}

/** A sanitized service failure with no raw headers, credentials, or response. */
export class RemoteError extends Error {
  readonly service: RemoteService;
  readonly code: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly details: Json | null;

  constructor(message: string, options: RemoteErrorOptions) {
    super(message);
    this.name = "RemoteError";
    this.service = options.service;
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details;
  }
}

const REMOTE_CONTINUATION_PREFIX = "rp1";

function remoteAbortError(service: RemoteService): RemoteError {
  return new RemoteError("Remote operation was aborted", {
    service,
    code: "REMOTE_ABORTED",
    status: null,
    retryable: false,
    retryAfterMs: null,
    details: null,
  });
}

function assertRemoteCallActive(
  service: RemoteService,
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) throw remoteAbortError(service);
}

async function awaitRemoteCall<T>(
  service: RemoteService,
  signal: AbortSignal | undefined,
  operation: Promise<T>,
): Promise<T> {
  assertRemoteCallActive(service, signal);
  if (!signal) return operation;

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(remoteAbortError(service));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function invalidPagingError(
  service: RemoteService,
  code: string,
  details: Json,
): RemoteError {
  return new RemoteError("Invalid remote paging state", {
    service,
    code,
    status: null,
    retryable: false,
    retryAfterMs: null,
    details,
  });
}

function encodeRemoteContinuation(index: number, pageSize: number): string {
  return `${REMOTE_CONTINUATION_PREFIX}.${index.toString(36)}.${pageSize.toString(36)}`;
}

function decodeRemoteContinuation(
  continuation: string,
  service: RemoteService,
): { index: number; pageSize: number } {
  const match = /^rp1\.([0-9a-z]+)\.([0-9a-z]+)$/.exec(continuation);
  if (!match) {
    throw invalidPagingError(service, "REMOTE_BAD_CONTINUATION", null);
  }

  const index = Number.parseInt(match[1], 36);
  const pageSize = Number.parseInt(match[2], 36);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1
  ) {
    throw invalidPagingError(service, "REMOTE_BAD_CONTINUATION", null);
  }
  return { index, pageSize };
}

/**
 * Adapts offset-, page-, or registry-backed loaders to one resumable stream.
 * Transport implementations map the normalized item index inside `load`.
 */
export async function* iterateRemotePages<T>(
  page: RemotePageRequest | undefined,
  ctx: RemoteCallContext | undefined,
  options: RemotePageAdapterOptions,
  load: (request: RemotePageLoadRequest) => Promise<RemotePageBatch<T>>,
): AsyncIterable<RemotePage<T>> {
  const decoded = page?.continuation
    ? decodeRemoteContinuation(page.continuation, options.service)
    : null;
  const requestedPageSize = page?.pageSize ?? decoded?.pageSize;
  const pageSize = requestedPageSize ?? options.defaultPageSize;

  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > options.maxPageSize
  ) {
    throw invalidPagingError(options.service, "REMOTE_INVALID_PAGE_SIZE", {
      pageSize,
      maxPageSize: options.maxPageSize,
    });
  }
  if (decoded && page?.pageSize !== undefined && page.pageSize !== decoded.pageSize) {
    throw invalidPagingError(
      options.service,
      "REMOTE_CONTINUATION_PAGE_SIZE_MISMATCH",
      null,
    );
  }

  let index = decoded?.index ?? 0;
  while (true) {
    assertRemoteCallActive(options.service, ctx?.signal);
    const request: RemotePageLoadRequest = {
      index,
      pageSize,
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    };
    const batch = await awaitRemoteCall(
      options.service,
      ctx?.signal,
      load(request),
    );
    assertRemoteCallActive(options.service, ctx?.signal);

    if (batch.hasMore && batch.items.length === 0) {
      throw invalidPagingError(
        options.service,
        "REMOTE_EMPTY_NONTERMINAL_PAGE",
        { index, pageSize },
      );
    }

    const nextIndex = index + batch.items.length;
    const next = batch.hasMore
      ? encodeRemoteContinuation(nextIndex, pageSize)
      : null;
    yield { items: batch.items, total: batch.total, next };
    if (!batch.hasMore) return;
    index = nextIndex;
  }
}

export interface RemoteArtifact {
  readonly mediaType: string;
  readonly size: number | null;
  readonly sha256: string | null;
  stream(): AsyncIterable<Uint8Array>;
  readJson<T extends Json>(maxBytes: number): Promise<T>;
}

export interface RemoteArtifactSource {
  service: RemoteService;
  mediaType: string;
  size: number | null;
  sha256: string | null;
  stream(): AsyncIterable<Uint8Array>;
}

function artifactError(
  source: RemoteArtifactSource,
  code: string,
  message: string,
  details: Json,
): RemoteError {
  return new RemoteError(message, {
    service: source.service,
    code,
    status: null,
    retryable: false,
    retryAfterMs: null,
    details,
  });
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJson);
}

/** Creates a byte-only artifact that enforces declared size/hash boundaries. */
export function createRemoteArtifact(
  source: RemoteArtifactSource,
): RemoteArtifact {
  if (
    source.size !== null &&
    (!Number.isSafeInteger(source.size) || source.size < 0)
  ) {
    throw artifactError(
      source,
      "REMOTE_ARTIFACT_INVALID_METADATA",
      "Artifact size metadata is invalid",
      { size: source.size },
    );
  }
  if (source.sha256 !== null && !/^[0-9a-f]{64}$/.test(source.sha256)) {
    throw artifactError(
      source,
      "REMOTE_ARTIFACT_INVALID_METADATA",
      "Artifact digest metadata is invalid",
      null,
    );
  }

  const artifact: RemoteArtifact = {
    mediaType: source.mediaType,
    size: source.size,
    sha256: source.sha256,
    async *stream() {
      let bytes = 0;
      const hash = source.sha256 === null ? null : createHash("sha256");
      for await (const chunk of source.stream()) {
        if (!(chunk instanceof Uint8Array)) {
          throw artifactError(
            source,
            "REMOTE_ARTIFACT_INVALID_CHUNK",
            "Artifact stream yielded a non-byte chunk",
            null,
          );
        }
        bytes += chunk.byteLength;
        if (source.size !== null && bytes > source.size) {
          throw artifactError(
            source,
            "REMOTE_ARTIFACT_SIZE_MISMATCH",
            "Artifact stream exceeded its declared size",
            { expected: source.size, actual: bytes },
          );
        }
        hash?.update(chunk);
        yield chunk;
      }
      if (source.size !== null && bytes !== source.size) {
        throw artifactError(
          source,
          "REMOTE_ARTIFACT_SIZE_MISMATCH",
          "Artifact stream did not match its declared size",
          { expected: source.size, actual: bytes },
        );
      }
      if (source.sha256 !== null && hash?.digest("hex") !== source.sha256) {
        throw artifactError(
          source,
          "REMOTE_ARTIFACT_HASH_MISMATCH",
          "Artifact stream did not match its declared digest",
          null,
        );
      }
    },
    async readJson<T extends Json>(maxBytes: number): Promise<T> {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        throw artifactError(
          source,
          "REMOTE_ARTIFACT_INVALID_LIMIT",
          "Artifact JSON read limit is invalid",
          { maxBytes },
        );
      }
      if (source.size !== null && source.size > maxBytes) {
        throw artifactError(
          source,
          "REMOTE_ARTIFACT_TOO_LARGE",
          "Artifact exceeds the JSON read limit",
          { maxBytes, size: source.size },
        );
      }

      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of artifact.stream()) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          throw artifactError(
            source,
            "REMOTE_ARTIFACT_TOO_LARGE",
            "Artifact exceeds the JSON read limit",
            { maxBytes, size: bytes },
          );
        }
        chunks.push(chunk);
      }

      const combined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }

      try {
        const parsed: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(combined),
        );
        if (!isJson(parsed)) throw new TypeError("JSON value is not JSON-safe");
        return parsed as T;
      } catch (error: unknown) {
        if (error instanceof RemoteError) throw error;
        throw artifactError(
          source,
          "REMOTE_ARTIFACT_INVALID_JSON",
          "Artifact did not contain valid JSON",
          null,
        );
      }
    },
  };
  return artifact;
}

/** Enforces operations whose reviewed HTTP contract is exactly 204/empty. */
export function assertRemoteNoContent(input: {
  service: RemoteService;
  operation: string;
  status: number;
  bodyBytes: number;
}): void {
  if (input.status === 204 && input.bodyBytes === 0) return;
  throw new RemoteError("Remote operation returned an unexpected response", {
    service: input.service,
    code: "REMOTE_EXPECTED_NO_CONTENT",
    status: input.status,
    retryable: false,
    retryAfterMs: null,
    details: { operation: input.operation, bodyBytes: input.bodyBytes },
  });
}

export const VEX_STATUSES = [
  "EXPLOITABLE",
  "IN_TRIAGE",
  "NOT_AFFECTED",
  "FALSE_POSITIVE",
  "RESOLVED",
  "RESOLVED_WITH_PEDIGREE",
] as const;

export const VEX_RESPONSES = [
  "CAN_NOT_FIX",
  "WILL_NOT_FIX",
  "UPDATE",
  "ROLLBACK",
  "WORKAROUND_AVAILABLE",
] as const;

export const VEX_JUSTIFICATIONS = [
  "CODE_NOT_PRESENT",
  "CODE_NOT_REACHABLE",
  "REQUIRES_CONFIGURATION",
  "REQUIRES_DEPENDENCY",
  "REQUIRES_ENVIRONMENT",
  "PROTECTED_BY_COMPILER",
  "PROTECTED_AT_RUNTIME",
  "PROTECTED_AT_PERIMETER",
  "PROTECTED_BY_MITIGATING_CONTROL",
] as const;

/** Owner-service chunk size; the Platform endpoint itself permits 5,000. */
export const VEX_RESUMABLE_CHUNK_SIZE = 500;
export const VEX_PLATFORM_MAX_BATCH_SIZE = 5_000;
export const FIRMWARE_RANGE_MAX_BYTES = 131_072;

export type VexStatus = (typeof VEX_STATUSES)[number];
export type VexResponse = (typeof VEX_RESPONSES)[number];
export type VexJustification = (typeof VEX_JUSTIFICATIONS)[number];

export interface VexDecisionInput {
  findingId: string;
  status: VexStatus;
  response?: VexResponse;
  justification?: VexJustification;
  reason?: string;
}

export interface VexInput extends VexDecisionInput {
  projectVersionId: string;
}

/**
 * Normalizes UI/YAML optional values before the mutating Platform boundary.
 * Empty strings never become wire fields, and finding ids follow the vendored
 * decimal-string schema so int64 precision is preserved.
 */
export function normalizeVexDecisionInput(input: {
  findingId: string;
  status: VexStatus;
  response?: VexResponse | "";
  justification?: VexJustification | "";
  reason?: string;
}): VexDecisionInput {
  if (!/^-?[0-9]+$/.test(input.findingId)) {
    throw new RemoteError("Finding id must be a decimal string", {
      service: "platform",
      code: "PLATFORM_INVALID_FINDING_ID",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: null,
    });
  }
  return {
    findingId: input.findingId,
    status: input.status,
    ...(input.response ? { response: input.response } : {}),
    ...(input.justification ? { justification: input.justification } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export interface VexBulkSetResult {
  status: "success" | "partial_success" | "failure";
  summary: { total: number; succeeded: number; failed: number };
  /** One result for each request item, in request order. */
  results: {
    findingId: string;
    success: boolean;
    status: VexStatus | null;
    error: string | null;
  }[];
}

export interface ComponentListInput {
  filter?: string;
  excluded?: boolean;
  sort?: string;
  page?: RemotePageRequest;
  editStatus?: "any" | "edited" | "unedited";
}

export interface ComponentSearchInput {
  name: string;
  version?: string;
  page?: RemotePageRequest;
  sort?: string;
}

export interface PlatformClient {
  health(ctx?: RemoteCallContext): Promise<RemoteHealth>;
  listProjects(
    page?: RemotePageRequest,
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  listVersions(
    projectId: string,
    page?: RemotePageRequest,
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  getFindings(
    input: { projectVersionId: string; page?: RemotePageRequest },
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  getFindingDetail(
    input: { projectVersionId: string; findingId: string },
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json>>;
  getFindingActivity(
    input: {
      projectId: string;
      projectVersionId: string;
      cve: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  /** Reads comments embedded by the verified findings endpoint. */
  listFindingComments(
    input: {
      projectVersionId: string;
      findingId: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  getFindingsSummary(
    projectVersionId: string,
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json>>;
  setVexStatus(
    input: VexInput,
    ctx?: RemoteCallContext,
  ): Promise<void>;
  batchSetVexStatus(
    input: { projectVersionId: string; findings: VexDecisionInput[] },
    ctx?: RemoteCallContext,
  ): Promise<VexBulkSetResult>;
  /** Resolves only after the verified 204 response; there is no result body. */
  clearVexStatus(
    input: { projectVersionId: string; findingIds: string[] },
    ctx?: RemoteCallContext,
  ): Promise<void>;
  downloadSbom(
    input: {
      projectVersionId: string;
      format: "cyclonedx" | "spdx";
      includeVex: boolean;
    },
    ctx?: RemoteCallContext,
  ): Promise<RemoteArtifact>;
  listComponents(
    input: ComponentListInput,
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  searchComponents(
    input: ComponentSearchInput,
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  browseFirmwareFilesystem(
    input: {
      projectVersionId: string;
      path?: string;
      depth?: number;
      fileHash?: string;
      scanId?: string;
    },
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json>>;
  getFirmwareFile(
    input: FirmwareFileMetadataRequest,
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json>>;
  getFirmwareFile(
    input: FirmwareFileByteRequest,
    ctx?: RemoteCallContext,
  ): Promise<RemoteArtifact>;
  securityAssessment(
    input: SecurityAssessmentRequest,
    ctx?: RemoteCallContext,
  ): Promise<Json>;
}

export interface FirmwareTreeNode {
  path: string;
  hash: string | null;
  kind: "file" | "directory" | "symlink";
  size: number | null;
  fields: Record<string, Json>;
}

export interface FirmwareFileMetadataRequest {
  projectVersionId: string;
  scanId?: string;
  fileHash: string;
  mode: "meta";
}

export type FirmwareFileByteRequest =
  | {
      projectVersionId: string;
      scanId?: string;
      fileHash: string;
      mode: "range";
      offset: number;
      maxBytes: number;
    }
  | {
      projectVersionId: string;
      scanId?: string;
      fileHash: string;
      mode: "full";
    }
  | { fromScanId: string; fileHash: string; mode: "full" };

export type FirmwareFileRequest =
  | FirmwareFileMetadataRequest
  | FirmwareFileByteRequest;

export const SECURITY_ASSESSMENT_TOOLS = [
  "stp_callgraph",
  "stp_find_binaries_with_symbols",
  "stp_elf_dependency_graph",
  "stp_binary_details",
  "stp_kernel_config",
  "get_scan_quality",
  "stp_architecture",
  "stp_configs",
  "stp_services",
  "stp_crypto",
] as const;

export type SecurityAssessmentTool =
  (typeof SECURITY_ASSESSMENT_TOOLS)[number];

export interface SecurityAssessmentRequest {
  tool: SecurityAssessmentTool;
  projectVersionId: string;
  scanId?: string;
  params?: Record<string, Json>;
}

export type AsEntityKind =
  | "threat"
  | "risk"
  | "mitigation"
  | "asset"
  | "zone"
  | "dataflow"
  | "component"
  | "requirement"
  | "attack-path";

export type AsCreatableEntityKind = Exclude<AsEntityKind, "attack-path">;

export type AsReviewStatus =
  | "pending"
  | "ai_approved"
  | "ai_flagged"
  | "human_approved"
  | "human_rejected";

export interface AsEntity {
  id: string;
  projectId: string;
  kind: AsEntityKind;
  /** Decimal bigint string; never coerce this concurrency token to a number. */
  reviewVersion: string | null;
  reviewStatus: AsReviewStatus | null;
  humanEdited: boolean | null;
  fields: Record<string, Json>;
}

export interface AsWriteResult {
  success: true;
  entity: AsEntity;
  reviewStatusSet: boolean;
  reviewStatusReason: string | null;
}

export interface AsDeleteImpact {
  allowedActions: ("cascade" | "detach")[];
  recommendedAction: "cascade" | "detach" | null;
  references: Json[];
}

/**
 * Client-neutral TARA concurrency values.
 *
 * No TARA state/checkpoint client member is frozen in v1 because the vendored
 * authority does not verify a public route for either operation.
 */
export interface TaraFence {
  expectedHeadVersionId: string;
  expectedWorkingHash?: string;
}

export interface TaraState {
  headVersionId: string;
  workingHash: string | null;
}

export interface AssuranceStudioClient {
  health(ctx?: RemoteCallContext): Promise<RemoteHealth>;
  listEntities(
    kind: AsEntityKind,
    input: {
      projectId: string;
      page?: RemotePageRequest;
      filters?: Record<string, Json>;
    },
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<AsEntity>>;
  getEntity(
    kind: AsEntityKind,
    input: { projectId: string; id: string },
    ctx?: RemoteCallContext,
  ): Promise<AsEntity>;
  createEntity(
    kind: AsCreatableEntityKind,
    input: { projectId: string; fields: Record<string, Json> },
    ctx?: RemoteCallContext,
  ): Promise<AsWriteResult>;
  updateEntity(
    kind: AsEntityKind,
    input: {
      projectId: string;
      id: string;
      fields: Record<string, Json>;
      force?: boolean;
    },
    ctx?: RemoteCallContext,
  ): Promise<AsWriteResult>;
  deleteEntity(
    kind: AsEntityKind,
    input: {
      projectId: string;
      id: string;
      mode?: "cascade" | "detach";
      force?: boolean;
    },
    ctx?: RemoteCallContext,
  ): Promise<
    { success: true } | { success: false; impact: AsDeleteImpact }
  >;
  listProjectSbomPackages(
    input: {
      projectId: string;
      page?: RemotePageRequest;
      filters?: Record<string, Json>;
    },
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  listVerificationChecks(
    input: {
      projectId: string;
      status?: string;
      type?: string;
      requirementId?: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<Record<string, Json>>>;
  /** Includes the check's verified historical `results` collection. */
  getVerificationCheck(
    input: { projectId: string; checkId: string },
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json>>;
  runVerificationChecks(
    input: {
      projectId: string;
      checkIds?: string[];
      rerunPassed?: boolean;
    },
    ctx?: RemoteCallContext,
  ): Promise<{ runId: string; checksQueued: number; status: string }>;
}

export const FORGE_JOB_STATUSES = [
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "TIMEOUT",
] as const;

export const FORGE_JOB_TERMINAL_STATUSES = [
  "COMPLETED",
  "FAILED",
  "TIMEOUT",
] as const;

export const FORGE_COMPUTE_INVOCATIONS = [
  "verify_dynamic",
  "pen_test_run",
  "get_job_status",
  "list_jobs",
] as const;

export type ForgeJobStatus = (typeof FORGE_JOB_STATUSES)[number];
export type ForgeJobTerminalStatus =
  (typeof FORGE_JOB_TERMINAL_STATUSES)[number];
export type ForgeComputeInvocation =
  (typeof FORGE_COMPUTE_INVOCATIONS)[number];

export interface ForgeJobError {
  code: string;
  message: string | null;
}

export interface ForgeJobSnapshot {
  jobId: string;
  status: ForgeJobStatus;
  /** Open registry metadata; this is not an MCP invocation selector. */
  tool: string;
  recipe: string | null;
  scope: Json;
  environment: Json;
  runId: string | null;
  elapsedSeconds: number;
  logTail: string[];
  events: Json[];
  eventCount: number;
  result: Json | null;
  /** Raw CANCELLED is represented as FAILED with FORGE_JOB_CANCELLED here. */
  error: ForgeJobError | null;
}

export interface ForgeJobCandidate
  extends Omit<ForgeJobSnapshot, "status" | "error"> {
  status: ForgeJobStatus | "CANCELLED";
  error?: ForgeJobError | null;
}

/** Normalizes the raw registry-only CANCELLED state without closing tool metadata. */
export function normalizeForgeJobSnapshot(
  candidate: ForgeJobCandidate,
): ForgeJobSnapshot {
  if (candidate.status === "CANCELLED") {
    return {
      ...candidate,
      status: "FAILED",
      error: {
        code: "FORGE_JOB_CANCELLED",
        message: candidate.error?.message ?? "Forge cancelled job",
      },
    };
  }
  return {
    ...candidate,
    status: candidate.status,
    error: candidate.error ?? null,
  };
}

export interface ForgeDeploymentContext {
  productType: string;
  networkExposure: string;
  regulatory: string;
  deploymentNotes: string;
  rootComponentName: string;
  rootComponentType: string;
}

export interface ForgePenTestInput {
  cveId: string;
  componentId: string;
  projectId: string;
  projectVersionId: string;
  findingId?: string | null;
  profileHint?: string | null;
  tenantId?: string;
  deploymentContext?: ForgeDeploymentContext | null;
  budget?: Record<string, Json> | null;
  replaySeed?: number;
  authoringEnabled?: boolean;
  blind?: boolean;
  confidenceFloor?: number | null;
  llmProvider?: "anthropic" | "openai" | "google" | null;
  llmModel?: string | null;
}

export interface ForgeComputeClient {
  health(ctx?: RemoteCallContext): Promise<RemoteHealth>;
  verifyDynamic(
    input: {
      projectVersionId: string;
      verdictIds: string[];
      budgetSecPerVerdict?: number;
    },
    ctx?: RemoteCallContext,
  ): Promise<Json>;
  penTestRun(
    input: ForgePenTestInput,
    ctx?: RemoteCallContext,
  ): Promise<{ jobId: string }>;
  getJobStatus(
    jobId: string,
    tailLines?: number,
    ctx?: RemoteCallContext,
  ): Promise<ForgeJobSnapshot>;
  listJobs(
    input?: {
      status?: ForgeJobStatus;
      tool?: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ): AsyncIterable<RemotePage<ForgeJobSnapshot>>;
  watchJob(
    jobId: string,
    ctx?: RemoteCallContext,
  ): AsyncIterable<ForgeJobSnapshot>;
}

export interface RemoteServices {
  platform: PlatformClient;
  assuranceStudio: AssuranceStudioClient;
  forgeCompute: ForgeComputeClient | null;
}
