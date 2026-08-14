import { artifactFromResponse } from "../artifact.js";
import {
  responseError,
  transportError,
  withRemoteRequestTimeout,
} from "../errors.js";
import { RemoteLimiter, systemScheduler } from "../rate-limit.js";
import {
  PLATFORM_ROUTES,
  SECURITY_ASSESSMENT_ROUTES,
  type PlatformRoute,
} from "./routes.js";
import {
  FIRMWARE_RANGE_MAX_BYTES,
  RemoteError,
  assertRemoteNoContent,
  iterateRemotePages,
  normalizeVexDecisionInput,
  type FirmwareFileByteRequest,
  type FirmwareFileMetadataRequest,
  type Json,
  type PlatformClient as PlatformClientContract,
  type RemoteArtifact,
  type RemoteCallContext,
  type RemoteHealth,
  type RemotePage,
  type RemotePageRequest,
  type SecurityAssessmentRequest,
  type VexBulkSetResult,
  type VexInput,
  type VexStatus,
} from "../types.js";

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PlatformClientOptions {
  baseUrl: string;
  token: string;
  concurrency?: number;
  fetch?: Fetch;
  limiter?: RemoteLimiter;
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === "object" && Object.values(value).every(isJson);
}

function record(value: unknown): Record<string, Json> {
  if (
    !isJson(value) ||
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object"
  ) {
    throw new RemoteError("Platform returned an invalid JSON object", {
      service: "platform",
      code: "PLATFORM_INVALID_RESPONSE",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: null,
    });
  }
  return value;
}

function records(value: unknown): {
  items: Record<string, Json>[];
  total: number | null;
} {
  if (Array.isArray(value)) return { items: value.map(record), total: null };
  const envelope = record(value);
  const candidates = [
    envelope.items,
    envelope.data,
    envelope.results,
    envelope.content,
  ];
  const items = candidates.find(Array.isArray);
  if (!Array.isArray(items))
    throw new RemoteError("Platform list response had no items", {
      service: "platform",
      code: "PLATFORM_INVALID_RESPONSE",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: null,
    });
  const totalValue = envelope.total ?? envelope.totalCount ?? envelope.count;
  return {
    items: items.map(record),
    total:
      typeof totalValue === "number" &&
      Number.isSafeInteger(totalValue) &&
      totalValue >= 0
        ? totalValue
        : null,
  };
}

function rsql(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 4_096 ||
    /[\r\n\0]/u.test(trimmed) ||
    !/^[\w\s.,;:'"*()=<>!+\-/]+$/u.test(trimmed)
  ) {
    throw new RemoteError("Platform filter is not valid RSQL", {
      service: "platform",
      code: "PLATFORM_INVALID_RSQL",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: null,
    });
  }
  let depth = 0;
  for (const character of trimmed) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) break;
  }
  if (depth !== 0)
    throw new RemoteError("Platform filter is not valid RSQL", {
      service: "platform",
      code: "PLATFORM_INVALID_RSQL",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: null,
    });
  return trimmed;
}

function rsqlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 256 ||
    !/^[A-Za-z0-9_.:+\-/]+$/u.test(trimmed)
  ) {
    throw new RemoteError("Platform filter value is not a safe RSQL scalar", {
      service: "platform",
      code: "PLATFORM_INVALID_RSQL",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: null,
    });
  }
  return trimmed;
}

function vexStatus(value: Json | undefined): VexStatus | null {
  return value === "EXPLOITABLE" ||
    value === "IN_TRIAGE" ||
    value === "NOT_AFFECTED" ||
    value === "FALSE_POSITIVE" ||
    value === "RESOLVED" ||
    value === "RESOLVED_WITH_PEDIGREE"
    ? value
    : null;
}

function set(
  url: URL,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined) url.searchParams.set(key, String(value));
}

function path(
  route: PlatformRoute,
  parameters: Readonly<Record<string, string>>,
): string {
  return route.path.replace(/\{([^}]+)\}/gu, (_match, key: string) => {
    const value = parameters[key];
    if (value === undefined || value.length === 0)
      throw new TypeError(`Missing route parameter: ${key}`);
    return encodeURIComponent(value);
  });
}

export class PlatformClient implements PlatformClientContract {
  readonly #baseUrl: URL;
  readonly #token: string;
  readonly #fetch: Fetch;
  readonly #limiter: RemoteLimiter;

  constructor(options: PlatformClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!this.#baseUrl.pathname.endsWith("/")) this.#baseUrl.pathname += "/";
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#limiter =
      options.limiter ??
      new RemoteLimiter({
        concurrency: options.concurrency ?? 8,
        maxAttempts: 6,
        maxBackoffMs: 64_000,
        scheduler: systemScheduler,
        random: Math.random,
      });
  }

  close(): void {
    this.#limiter.close();
  }

  async #send(
    route: PlatformRoute,
    parameters: Readonly<Record<string, string>>,
    query: Readonly<Record<string, string | number | boolean | undefined>>,
    body: Json | undefined,
    ctx?: RemoteCallContext,
  ): Promise<Response> {
    const url = new URL(
      path(route, parameters).replace(/^\/+/u, ""),
      this.#baseUrl,
    );
    for (const [key, value] of Object.entries(query)) set(url, key, value);
    const request = {
      method: route.method,
      url: url.toString(),
      phase: `request headers for ${route.operationId}`,
    };
    return await this.#limiter.run(async () => {
      let response: Response;
      try {
        response = await withRemoteRequestTimeout(
          "platform",
          request,
          ctx?.signal,
          (signal) =>
            this.#fetch(url, {
              method: route.method,
              headers: {
                "X-Authorization": this.#token,
                ...(body === undefined
                  ? {}
                  : { "Content-Type": "application/json" }),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              signal,
            }),
        );
      } catch (error: unknown) {
        throw transportError(
          "platform",
          route.operationId,
          route.retry !== "write-once",
          error,
          request,
        );
      }
      if (!response.ok) {
        const error = await responseError(
          "platform",
          response,
          Date.now(),
          request,
        );
        if (route.retry === "write-once" && error.retryable) {
          throw new RemoteError(error.message, { ...error, retryable: false });
        }
        throw error;
      }
      return response;
    }, ctx?.signal);
  }

  async #json(
    route: PlatformRoute,
    parameters: Readonly<Record<string, string>> = {},
    query: Readonly<Record<string, string | number | boolean | undefined>> = {},
    body?: Json,
    ctx?: RemoteCallContext,
  ): Promise<unknown> {
    const response = await this.#send(route, parameters, query, body, ctx);
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim();
    if (mediaType !== "application/json")
      throw new RemoteError("Platform returned an unexpected media type", {
        service: "platform",
        code: "PLATFORM_MEDIA_TYPE",
        status: response.status,
        retryable: false,
        retryAfterMs: null,
        details: { mediaType: mediaType ?? null },
      });
    try {
      return await response.json();
    } catch {
      throw new RemoteError("Platform returned invalid JSON", {
        service: "platform",
        code: "PLATFORM_INVALID_JSON",
        status: response.status,
        retryable: false,
        retryAfterMs: null,
        details: null,
      });
    }
  }

  async health(ctx?: RemoteCallContext): Promise<RemoteHealth> {
    await this.#json(
      PLATFORM_ROUTES.health,
      {},
      { offset: 0, limit: 1 },
      undefined,
      ctx,
    );
    return { configured: true, reachable: true, detail: null };
  }

  #pages(
    route: PlatformRoute,
    parameters: Readonly<Record<string, string>>,
    query: Readonly<Record<string, string | number | boolean | undefined>>,
    page: RemotePageRequest | undefined,
    ctx: RemoteCallContext | undefined,
  ): AsyncIterable<RemotePage<Record<string, Json>>> {
    return iterateRemotePages(
      page,
      ctx,
      { service: "platform", defaultPageSize: 50, maxPageSize: 1_000 },
      async (request) => {
        const value = await this.#json(
          route,
          parameters,
          { ...query, offset: request.index, limit: request.pageSize },
          undefined,
          ctx,
        );
        const normalized = records(value);
        const hasMore =
          normalized.total === null
            ? normalized.items.length === request.pageSize
            : request.index + normalized.items.length < normalized.total;
        return { ...normalized, hasMore };
      },
    );
  }

  listProjects(page?: RemotePageRequest, ctx?: RemoteCallContext) {
    return this.#pages(PLATFORM_ROUTES.listProjects, {}, {}, page, ctx);
  }
  listVersions(
    projectId: string,
    page?: RemotePageRequest,
    ctx?: RemoteCallContext,
  ) {
    return this.#pages(
      PLATFORM_ROUTES.listVersions,
      { projectId },
      {},
      page,
      ctx,
    );
  }
  getFindings(
    input: { projectVersionId: string; page?: RemotePageRequest },
    ctx?: RemoteCallContext,
  ) {
    return this.#pages(
      PLATFORM_ROUTES.getFindings,
      { projectVersionId: input.projectVersionId },
      {},
      input.page,
      ctx,
    );
  }
  async getFindingDetail(
    input: { projectVersionId: string; findingId: string },
    ctx?: RemoteCallContext,
  ) {
    const projectVersionId = rsqlScalar(input.projectVersionId);
    const findingId = rsqlScalar(input.findingId);
    const value = await this.#json(
      PLATFORM_ROUTES.getFindingDetail,
      {},
      {
        filter: rsql(
          `projectVersion==${projectVersionId};findingId==${findingId}`,
        ),
        limit: 1,
        includeAdditionalDetails: true,
        includeComments: true,
      },
      undefined,
      ctx,
    );
    const normalized = records(value);
    const item = normalized.items[0];
    if (!item)
      throw new RemoteError("Platform finding was not found", {
        service: "platform",
        code: "PLATFORM_FINDING_NOT_FOUND",
        status: 404,
        retryable: false,
        retryAfterMs: null,
        details: null,
      });
    return item;
  }
  getFindingActivity(
    input: {
      projectId: string;
      projectVersionId: string;
      cve: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.#pages(
      PLATFORM_ROUTES.getFindingActivity,
      { projectId: input.projectId },
      {
        projectVersionId: input.projectVersionId,
        cve: input.cve,
      },
      input.page,
      ctx,
    );
  }
  listFindingComments(
    input: {
      projectVersionId: string;
      findingId: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ) {
    let comments: Promise<Record<string, Json>[]> | null = null;
    return iterateRemotePages(
      input.page,
      ctx,
      {
        service: "platform",
        defaultPageSize: 50,
        maxPageSize: 1_000,
      },
      async (request) => {
        comments ??= this.getFindingDetail(input, ctx).then((detail) => {
          const raw = detail.comments;
          return Array.isArray(raw) ? raw.map(record) : [];
        });
        const all = await comments;
        const items = all.slice(
          request.index,
          request.index + request.pageSize,
        );
        return {
          items,
          total: all.length,
          hasMore: request.index + items.length < all.length,
        };
      },
    );
  }
  async getFindingsSummary(projectVersionId: string, ctx?: RemoteCallContext) {
    const parameters = { projectVersionId };
    const [exploit, status, category, severity] = await Promise.all([
      this.#json(
        PLATFORM_ROUTES.getExploitCounts,
        parameters,
        {},
        undefined,
        ctx,
      ),
      this.#json(
        PLATFORM_ROUTES.getStatusCounts,
        parameters,
        {},
        undefined,
        ctx,
      ),
      this.#json(
        PLATFORM_ROUTES.getCategoryCounts,
        parameters,
        {},
        undefined,
        ctx,
      ),
      this.#json(
        PLATFORM_ROUTES.getSeverityCounts,
        parameters,
        {},
        undefined,
        ctx,
      ),
    ]);
    return {
      exploit: record(exploit),
      status: record(status),
      category: record(category),
      severity: record(severity),
    };
  }
  async setVexStatus(input: VexInput, ctx?: RemoteCallContext): Promise<void> {
    const normalized = normalizeVexDecisionInput(input);
    const response = await this.#send(
      PLATFORM_ROUTES.setVexStatus,
      {
        projectVersionId: input.projectVersionId,
        findingId: normalized.findingId,
      },
      {},
      {
        status: normalized.status,
        ...(normalized.response ? { response: normalized.response } : {}),
        ...(normalized.justification
          ? { justification: normalized.justification }
          : {}),
        ...(normalized.reason ? { reason: normalized.reason } : {}),
      },
      ctx,
    );
    assertRemoteNoContent({
      service: "platform",
      operation: "updateFindingStatusV0",
      status: response.status,
      bodyBytes: (await response.arrayBuffer()).byteLength,
    });
  }
  async batchSetVexStatus(
    input: {
      projectVersionId: string;
      findings: import("../types.js").VexDecisionInput[];
    },
    ctx?: RemoteCallContext,
  ): Promise<VexBulkSetResult> {
    const findings = input.findings.map(normalizeVexDecisionInput);
    if (findings.length > 5_000)
      throw new RemoteError("Platform VEX batch exceeds the endpoint maximum", {
        service: "platform",
        code: "PLATFORM_VEX_BATCH_TOO_LARGE",
        status: null,
        retryable: false,
        retryAfterMs: null,
        details: { count: findings.length },
      });
    const wireFindings: Json[] = findings.map((item) => ({
      findingId: item.findingId,
      status: item.status,
      ...(item.response ? { response: item.response } : {}),
      ...(item.justification ? { justification: item.justification } : {}),
      ...(item.reason ? { reason: item.reason } : {}),
    }));
    const value = record(
      await this.#json(
        PLATFORM_ROUTES.batchSetVexStatus,
        { projectVersionId: input.projectVersionId },
        {},
        { findings: wireFindings },
        ctx,
      ),
    );
    const summary = record(value.summary);
    const rawResults = Array.isArray(value.results)
      ? value.results.map(record)
      : [];
    const statusValue = value.status;
    if (
      (statusValue !== "success" &&
        statusValue !== "partial_success" &&
        statusValue !== "failure") ||
      typeof summary.total !== "number" ||
      !Number.isSafeInteger(summary.total) ||
      typeof summary.succeeded !== "number" ||
      !Number.isSafeInteger(summary.succeeded) ||
      typeof summary.failed !== "number" ||
      !Number.isSafeInteger(summary.failed) ||
      summary.total < 0 ||
      summary.succeeded < 0 ||
      summary.failed < 0 ||
      summary.total !== findings.length ||
      summary.succeeded + summary.failed !== summary.total ||
      rawResults.length !== findings.length
    ) {
      throw new RemoteError("Platform VEX bulk response was invalid", {
        service: "platform",
        code: "PLATFORM_INVALID_RESPONSE",
        status: null,
        retryable: false,
        retryAfterMs: null,
        details: null,
      });
    }
    const results = rawResults.map((item, index) => {
      const findingId =
        typeof item.findingId === "string" ? item.findingId : null;
      const success = typeof item.success === "boolean" ? item.success : null;
      const normalizedStatus = vexStatus(item.status);
      if (
        findingId !== findings[index]?.findingId ||
        success === null ||
        (success && normalizedStatus === null)
      ) {
        throw new RemoteError("Platform VEX bulk response was invalid", {
          service: "platform",
          code: "PLATFORM_INVALID_RESPONSE",
          status: null,
          retryable: false,
          retryAfterMs: null,
          details: null,
        });
      }
      return {
        findingId,
        success,
        status: normalizedStatus,
        error: typeof item.error === "string" ? item.error : null,
      };
    });
    return {
      status: statusValue,
      summary: {
        total: summary.total,
        succeeded: summary.succeeded,
        failed: summary.failed,
      },
      results,
    };
  }
  async clearVexStatus(
    input: { projectVersionId: string; findingIds: string[] },
    ctx?: RemoteCallContext,
  ): Promise<void> {
    const response = await this.#send(
      PLATFORM_ROUTES.clearVexStatus,
      { projectVersionId: input.projectVersionId },
      {},
      { findingIds: input.findingIds },
      ctx,
    );
    assertRemoteNoContent({
      service: "platform",
      operation: "bulkClearFindingStatusV0",
      status: response.status,
      bodyBytes: (await response.arrayBuffer()).byteLength,
    });
  }
  async downloadSbom(
    input: {
      projectVersionId: string;
      format: "cyclonedx" | "spdx";
      includeVex: boolean;
    },
    ctx?: RemoteCallContext,
  ): Promise<RemoteArtifact> {
    const route =
      input.format === "cyclonedx"
        ? PLATFORM_ROUTES.downloadCycloneDx
        : PLATFORM_ROUTES.downloadSpdx;
    const response = await this.#send(
      route,
      { projectVersionId: input.projectVersionId },
      { includeVex: input.includeVex },
      undefined,
      ctx,
    );
    return artifactFromResponse({
      service: "platform",
      response,
      allowedMediaTypes: [
        "application/json",
        "application/vnd.cyclonedx+json",
        "application/spdx+json",
      ],
    });
  }
  listComponents(
    input: {
      filter?: string;
      excluded?: boolean;
      sort?: string;
      page?: RemotePageRequest;
      editStatus?: "any" | "edited" | "unedited";
    },
    ctx?: RemoteCallContext,
  ) {
    return this.#pages(
      PLATFORM_ROUTES.listComponents,
      {},
      {
        filter: rsql(input.filter),
        excluded: input.excluded,
        sort: input.sort,
        editStatus: input.editStatus,
      },
      input.page,
      ctx,
    );
  }
  searchComponents(
    input: {
      name: string;
      version?: string;
      page?: RemotePageRequest;
      sort?: string;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.#pages(
      PLATFORM_ROUTES.searchComponents,
      {},
      { name: input.name, version: input.version, sort: input.sort },
      input.page,
      ctx,
    );
  }
  async browseFirmwareFilesystem(
    input: {
      projectVersionId: string;
      path?: string;
      depth?: number;
      fileHash?: string;
      scanId?: string;
    },
    ctx?: RemoteCallContext,
  ) {
    return record(
      await this.#json(
        PLATFORM_ROUTES.browseFirmwareFilesystem,
        { projectVersionId: input.projectVersionId },
        {
          path: input.path,
          depth: input.depth,
          hash: input.fileHash,
          scanId: input.scanId,
        },
        undefined,
        ctx,
      ),
    );
  }
  async getFirmwareFile(
    input: FirmwareFileMetadataRequest,
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json>>;
  async getFirmwareFile(
    input: FirmwareFileByteRequest,
    ctx?: RemoteCallContext,
  ): Promise<RemoteArtifact>;
  async getFirmwareFile(
    input: FirmwareFileMetadataRequest | FirmwareFileByteRequest,
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json> | RemoteArtifact> {
    if ("fromScanId" in input)
      throw new RemoteError(
        "Scan-only firmware addressing is unavailable on the direct API",
        {
          service: "platform",
          code: "PLATFORM_FIRMWARE_PROJECT_VERSION_REQUIRED",
          status: null,
          retryable: false,
          retryAfterMs: null,
          details: null,
        },
      );
    if (input.mode === "meta")
      return record(
        await this.#json(
          PLATFORM_ROUTES.getFirmwareMetadata,
          { projectVersionId: input.projectVersionId },
          { hash: input.fileHash, scanId: input.scanId },
          undefined,
          ctx,
        ),
      );
    if (
      input.mode === "range" &&
      (!Number.isSafeInteger(input.maxBytes) ||
        input.maxBytes < 1 ||
        input.maxBytes > FIRMWARE_RANGE_MAX_BYTES)
    ) {
      throw new RemoteError("Firmware range exceeds the client limit", {
        service: "platform",
        code: "PLATFORM_FIRMWARE_RANGE_INVALID",
        status: null,
        retryable: false,
        retryAfterMs: null,
        details: { maxBytes: input.maxBytes },
      });
    }
    const route =
      input.mode === "range"
        ? PLATFORM_ROUTES.getFirmwareRange
        : PLATFORM_ROUTES.getFirmwareFile;
    const response = await this.#send(
      route,
      { projectVersionId: input.projectVersionId },
      {
        hash: input.fileHash,
        scanId: input.scanId,
        ...(input.mode === "range"
          ? { offset: input.offset, maxBytes: input.maxBytes }
          : {}),
      },
      undefined,
      ctx,
    );
    return artifactFromResponse({
      service: "platform",
      response,
      allowedMediaTypes: ["application/octet-stream"],
    });
  }
  async securityAssessment(
    input: SecurityAssessmentRequest,
    ctx?: RemoteCallContext,
  ): Promise<Json> {
    const [suffix, operationId] = SECURITY_ASSESSMENT_ROUTES[input.tool];
    const route: PlatformRoute = {
      method: "GET",
      path: `/public/v0/projects/versions/{projectVersionId}/security-assessment/${suffix}`,
      operationId,
      requestMediaType: null,
      responseMediaType: "application/json",
      retry: "safe",
    };
    const value = await this.#json(
      route,
      { projectVersionId: input.projectVersionId },
      { scanId: input.scanId, ...input.params },
      undefined,
      ctx,
    );
    if (!isJson(value))
      throw new RemoteError(
        "Platform security assessment returned invalid JSON",
        {
          service: "platform",
          code: "PLATFORM_INVALID_RESPONSE",
          status: null,
          retryable: false,
          retryAfterMs: null,
          details: null,
        },
      );
    return value;
  }
}
