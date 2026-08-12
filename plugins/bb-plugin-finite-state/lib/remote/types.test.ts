import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  FIRMWARE_RANGE_MAX_BYTES,
  FORGE_COMPUTE_INVOCATIONS,
  FORGE_JOB_STATUSES,
  FORGE_JOB_TERMINAL_STATUSES,
  RemoteError,
  SECURITY_ASSESSMENT_TOOLS,
  VEX_JUSTIFICATIONS,
  VEX_PLATFORM_MAX_BATCH_SIZE,
  VEX_RESPONSES,
  VEX_RESUMABLE_CHUNK_SIZE,
  VEX_STATUSES,
  assertRemoteNoContent,
  createRemoteArtifact,
  iterateRemotePages,
  normalizeForgeJobSnapshot,
  normalizeVexDecisionInput,
  type AsEntity,
  type AsWriteResult,
  type AssuranceStudioClient,
  type ForgeComputeClient,
  type FirmwareFileByteRequest,
  type FirmwareFileMetadataRequest,
  type FirmwareFileRequest,
  type ForgeJobCandidate,
  type ForgeJobSnapshot,
  type Json,
  type PlatformClient,
  type RemoteArtifact,
  type RemoteCallContext,
  type RemotePage,
  type RemotePageAdapterOptions,
  type RemotePageBatch,
  type RemotePageLoadRequest,
  type RemotePageRequest,
  type RemoteServices,
} from "./types.js";

const apiReferenceRoot = resolve(
  import.meta.dirname,
  "../../docs/Implementation/api-reference",
);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function property(
  value: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
  return value[key];
}

function objectProperty(
  value: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> {
  return asRecord(property(value, key, label), `${label}.${key}`);
}

function parseMarkdownTableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .filter((line) => /^\|.+\|$/.test(line.trim()))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

function parseLevelTwoSections(
  markdown: string,
): Map<string, { heading: string; codeSpans: string[] }> {
  const sections = new Map<string, { heading: string; codeSpans: string[] }>();
  let current: { key: string; heading: string; lines: string[] } | null = null;

  const commit = () => {
    if (!current) return;
    const codeSpans = [...current.lines.join("\n").matchAll(/`([^`]+)`/g)].map(
      (match) => match[1],
    );
    sections.set(current.key, { heading: current.heading, codeSpans });
  };

  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(\d+)\.\s+(.+)$/.exec(line);
    if (heading) {
      commit();
      current = { key: heading[1], heading: heading[2], lines: [] };
    } else {
      current?.lines.push(line);
    }
  }
  commit();
  return sections;
}

const platformAuthority = asRecord(
  parseYaml(
    readFileSync(
      resolve(apiReferenceRoot, "finite-state-api-v0.3.0.openapi.yaml"),
      "utf8",
    ),
  ) as unknown,
  "Platform OpenAPI",
);

const assuranceStudioAuthority = asRecord(
  JSON.parse(
    readFileSync(
      resolve(apiReferenceRoot, "assurance-studio-openapi-2026-05-12.json"),
      "utf8",
    ),
  ) as unknown,
  "Assurance Studio OpenAPI",
);

const forgeAuthority = asRecord(
  JSON.parse(
    readFileSync(
      resolve(apiReferenceRoot, "forge-compute-manifest-5083a9d7.json"),
      "utf8",
    ),
  ) as unknown,
  "Forge compute manifest",
);

const assuranceStudioGaps = readFileSync(
  resolve(apiReferenceRoot, "assurance-studio-api-gaps.md"),
  "utf8",
);

async function* emptyPages<T>(): AsyncIterable<RemotePage<T>> {}
async function* emptyItems<T>(): AsyncIterable<T> {}

const streamedJson = new TextEncoder().encode('{"ok":true}');
const streamedJsonChunks = [streamedJson.slice(0, 5), streamedJson.slice(5)];
const streamedJsonSha256 = createHash("sha256").update(streamedJson).digest("hex");

function jsonArtifact(overrides?: {
  size?: number | null;
  sha256?: string | null;
}): RemoteArtifact {
  return createRemoteArtifact({
    service: "platform",
    mediaType: "application/json",
    size: overrides?.size ?? streamedJson.byteLength,
    sha256: overrides?.sha256 ?? streamedJsonSha256,
    async *stream() {
      for (const chunk of streamedJsonChunks) yield chunk;
    },
  });
}

const artifact = jsonArtifact();

function getFirmwareFile(
  input: FirmwareFileMetadataRequest,
  ctx?: RemoteCallContext,
): Promise<Record<string, Json>>;
function getFirmwareFile(
  input: FirmwareFileByteRequest,
  ctx?: RemoteCallContext,
): Promise<RemoteArtifact>;
async function getFirmwareFile(
  input: FirmwareFileRequest,
  _ctx?: RemoteCallContext,
): Promise<Record<string, Json> | RemoteArtifact> {
  return input.mode === "meta" ? {} : artifact;
}

const asEntity: AsEntity = {
  id: "entity-1",
  projectId: "project-1",
  kind: "threat",
  reviewVersion: "9007199254740993",
  reviewStatus: "pending",
  humanEdited: false,
  fields: {},
};

const asWriteResult: AsWriteResult = {
  success: true,
  entity: asEntity,
  reviewStatusSet: false,
  reviewStatusReason: "Route does not accept review_status",
};

const forgeCandidate: ForgeJobCandidate = {
  jobId: "job-1",
  status: "RUNNING",
  tool: "run_full_assessment",
  recipe: null,
  scope: {},
  environment: {},
  runId: null,
  elapsedSeconds: 0,
  logTail: [],
  events: [],
  eventCount: 0,
  result: null,
};

const forgeSnapshot = normalizeForgeJobSnapshot(forgeCandidate);

const platformFake = {
  async health() {
    return { configured: true, reachable: true, detail: null };
  },
  listProjects() {
    return emptyPages<Record<string, Json>>();
  },
  listVersions() {
    return emptyPages<Record<string, Json>>();
  },
  getFindings() {
    return emptyPages<Record<string, Json>>();
  },
  async getFindingDetail() {
    return {};
  },
  getFindingActivity() {
    return emptyPages<Record<string, Json>>();
  },
  listFindingComments() {
    return emptyPages<Record<string, Json>>();
  },
  async getFindingsSummary() {
    return {};
  },
  async setVexStatus(input) {
    normalizeVexDecisionInput(input);
    assertRemoteNoContent({
      service: "platform",
      operation: "setVexStatus",
      status: 204,
      bodyBytes: 0,
    });
  },
  async batchSetVexStatus(input) {
    const findings = input.findings.map(normalizeVexDecisionInput);
    return {
      status: "success",
      summary: {
        total: findings.length,
        succeeded: findings.length,
        failed: 0,
      },
      results: findings.map((decision) => ({
        findingId: decision.findingId,
        success: true,
        status: decision.status,
        error: null,
      })),
    };
  },
  async clearVexStatus(_input: {
    projectVersionId: string;
    findingIds: string[];
  }) {
    assertRemoteNoContent({
      service: "platform",
      operation: "clearVexStatus",
      status: 204,
      bodyBytes: 0,
    });
  },
  async downloadSbom() {
    return artifact;
  },
  listComponents() {
    return emptyPages<Record<string, Json>>();
  },
  searchComponents() {
    return emptyPages<Record<string, Json>>();
  },
  async browseFirmwareFilesystem() {
    return {};
  },
  getFirmwareFile,
  async securityAssessment() {
    return null;
  },
} satisfies PlatformClient;

const assuranceStudioFake = {
  async health() {
    return { configured: true, reachable: true, detail: null };
  },
  listEntities() {
    return emptyPages<AsEntity>();
  },
  async getEntity() {
    return asEntity;
  },
  async createEntity() {
    return asWriteResult;
  },
  async updateEntity() {
    return asWriteResult;
  },
  async deleteEntity() {
    return { success: true };
  },
  listProjectSbomPackages() {
    return emptyPages<Record<string, Json>>();
  },
  listVerificationChecks() {
    return emptyPages<Record<string, Json>>();
  },
  async getVerificationCheck() {
    return { results: [] };
  },
  async runVerificationChecks() {
    return { runId: "run-1", checksQueued: 1, status: "queued" };
  },
} satisfies AssuranceStudioClient;

const forgeComputeFake = {
  async health() {
    return { configured: true, reachable: true, detail: null };
  },
  async verifyDynamic() {
    return { verdicts: [] };
  },
  async penTestRun() {
    return { jobId: "job-1" };
  },
  async getJobStatus() {
    return forgeSnapshot;
  },
  listJobs() {
    return emptyPages<ForgeJobSnapshot>();
  },
  watchJob() {
    return emptyItems<ForgeJobSnapshot>();
  },
} satisfies ForgeComputeClient;

const PLATFORM_METHOD_EVIDENCE = {
  health: "client-local configured/reachable probe",
  listProjects: "OpenAPI GET /public/v0/projects",
  listVersions: "OpenAPI GET /public/v0/projects/{projectId}/versions",
  getFindings: "OpenAPI GET /public/v0/versions/{projectVersionId}/findings",
  getFindingDetail:
    "OpenAPI GET /public/v0/findings with includeAdditionalDetails",
  getFindingActivity:
    "OpenAPI GET /public/v0/projects/{projectId}/findings/activity",
  listFindingComments: "OpenAPI GET /public/v0/findings with includeComments",
  getFindingsSummary: "endpoint-audit.md charts get*Counts",
  setVexStatus:
    "OpenAPI PUT /public/v0/findings/{projectVersionId}/{findingId}/status",
  batchSetVexStatus:
    "OpenAPI PUT /public/v0/findings/{projectVersionId}/status/set/bulk",
  clearVexStatus:
    "OpenAPI PUT /public/v0/findings/{projectVersionId}/status/clear/bulk",
  downloadSbom: "OpenAPI GET /public/v0/sboms/{cyclonedx|spdx}/{id}",
  listComponents: "OpenAPI GET /public/v0/components",
  searchComponents: "OpenAPI GET /public/v0/components/search",
  browseFirmwareFilesystem:
    "OpenAPI GET /public/v0/projects/versions/{id}/filesystem/{tree|overview}",
  getFirmwareFile:
    "OpenAPI GET /public/v0/projects/versions/{id}/filesystem/{content|file}",
  securityAssessment:
    "OpenAPI /public/v0/projects/versions/{id}/security-assessment/*",
} satisfies Record<keyof PlatformClient, string>;

const ASSURANCE_STUDIO_METHOD_EVIDENCE = {
  health: "client-local configured/reachable probe",
  listEntities:
    "AS OpenAPI plus assurance-studio-api-gaps.md §2 handler-backed CRUD matrix",
  getEntity:
    "AS OpenAPI plus assurance-studio-api-gaps.md §2 handler-backed item routes",
  createEntity:
    "AS OpenAPI collection POSTs; gaps §2 marks attack-path POST as a stub",
  updateEntity:
    "AS OpenAPI plus assurance-studio-api-gaps.md §2 item PATCH routes",
  deleteEntity:
    "assurance-studio-api-gaps.md §2 shared delete policy and item routes",
  listProjectSbomPackages:
    "assurance-studio-api-gaps.md §6 handler-backed GET /api/projects/{id}/sbom",
  listVerificationChecks:
    "AS OpenAPI GET /api/projects/{projectId}/verification/checks",
  getVerificationCheck:
    "AS OpenAPI GET /api/projects/{projectId}/verification/checks/{checkId} with results",
  runVerificationChecks:
    "AS OpenAPI POST /api/projects/{projectId}/verification/run",
} satisfies Record<keyof AssuranceStudioClient, string>;

const FORGE_COMPUTE_METHOD_EVIDENCE = {
  health: "client-local configured/reachable probe",
  verifyDynamic: "compute manifest verify_dynamic",
  penTestRun: "compute manifest pen_test_run",
  getJobStatus: "compute manifest get_job_status",
  listJobs: "compute manifest list_jobs",
  watchJob: "compute manifest derived polling over get_job_status",
} satisfies Record<keyof ForgeComputeClient, string>;

async function collectPages<T>(
  pages: AsyncIterable<RemotePage<T>>,
): Promise<RemotePage<T>[]> {
  const collected: RemotePage<T>[] = [];
  for await (const page of pages) collected.push(page);
  return collected;
}

function pagingOptions(service: RemotePageAdapterOptions["service"]): RemotePageAdapterOptions {
  return { service, defaultPageSize: 2, maxPageSize: 100 };
}

function platformOffsetLoader<T>(
  items: T[],
  calls: number[],
): (request: RemotePageLoadRequest) => Promise<RemotePageBatch<T>> {
  return async ({ index, pageSize }) => {
    const offset = index;
    calls.push(offset);
    const pageItems = items.slice(offset, offset + pageSize);
    return {
      items: pageItems,
      total: items.length,
      hasMore: offset + pageItems.length < items.length,
    };
  };
}

function assuranceStudioPageLoader<T>(
  items: T[],
  calls: number[],
): (request: RemotePageLoadRequest) => Promise<RemotePageBatch<T>> {
  return async ({ index, pageSize }) => {
    const page = index / pageSize + 1;
    calls.push(page);
    const pageItems = items.slice(index, index + pageSize);
    return {
      items: pageItems,
      total: items.length,
      hasMore: index + pageItems.length < items.length,
    };
  };
}

function forgeRegistryLoader<T>(
  items: T[],
  calls: number[],
): (request: RemotePageLoadRequest) => Promise<RemotePageBatch<T>> {
  return async ({ index, pageSize }) => {
    calls.push(index);
    const pageItems = items.slice(index, index + pageSize);
    return {
      items: pageItems,
      total: items.length,
      hasMore: index + pageItems.length < items.length,
    };
  };
}

describe("remote-service-contract-freeze", () => {
  it("minimal fakes satisfy all clients and the nullable aggregate", async () => {
    const withoutForge: RemoteServices = {
      platform: platformFake,
      assuranceStudio: assuranceStudioFake,
      forgeCompute: null,
    };
    const withForge: RemoteServices = {
      platform: platformFake,
      assuranceStudio: assuranceStudioFake,
      forgeCompute: forgeComputeFake,
    };

    await expect(withoutForge.platform.health()).resolves.toMatchObject({
      reachable: true,
    });
    await expect(withForge.forgeCompute?.health()).resolves.toMatchObject({
      configured: true,
    });
  });

  it("preserves typed, secret-safe remote error metadata", () => {
    const error = new RemoteError("Rate limited", {
      service: "platform",
      code: "RATE_LIMITED",
      status: 429,
      retryable: true,
      retryAfterMs: 2_500,
      details: { operation: "getFindings" },
    });

    expect(error).toMatchObject({
      name: "RemoteError",
      service: "platform",
      code: "RATE_LIMITED",
      status: 429,
      retryable: true,
      retryAfterMs: 2_500,
    });
    expect(Object.keys(error)).not.toContain("headers");
    expect(Object.keys(error)).not.toContain("token");
  });

  it("structurally binds VEX vocabulary and 204 wire semantics to OpenAPI", () => {
    const paths = objectProperty(platformAuthority, "paths", "Platform OpenAPI");
    const singlePut = objectProperty(
      objectProperty(
        paths,
        "/public/v0/findings/{projectVersionId}/{findingId}/status",
        "paths",
      ),
      "put",
      "single status route",
    );
    const clearPut = objectProperty(
      objectProperty(
        paths,
        "/public/v0/findings/{projectVersionId}/status/clear/bulk",
        "paths",
      ),
      "put",
      "bulk clear route",
    );
    const schemas = objectProperty(
      objectProperty(platformAuthority, "components", "Platform OpenAPI"),
      "schemas",
      "components",
    );
    const singleRequest = objectProperty(
      schemas,
      "UpdateFindingStatusV0Request",
      "schemas",
    );
    const requestProperties = objectProperty(
      singleRequest,
      "properties",
      "UpdateFindingStatusV0Request",
    );

    expect(objectProperty(singlePut, "responses", "single status route")).toHaveProperty(
      "204",
    );
    expect(
      objectProperty(
        objectProperty(singlePut, "responses", "single status route"),
        "204",
        "single status responses",
      ),
    ).not.toHaveProperty("content");
    expect(objectProperty(clearPut, "responses", "bulk clear route")).toHaveProperty(
      "204",
    );
    expect(requestProperties).not.toHaveProperty("dryRun");
    expect(requestProperties).not.toHaveProperty("dry_run");

    const statusSchema = objectProperty(requestProperties, "status", "VEX request");
    const responseSchema = objectProperty(requestProperties, "response", "VEX request");
    const justificationSchema = objectProperty(
      requestProperties,
      "justification",
      "VEX request",
    );
    expect(new Set(asArray(statusSchema.enum, "status enum"))).toEqual(
      new Set(VEX_STATUSES),
    );
    expect(new Set(asArray(responseSchema.enum, "response enum"))).toEqual(
      new Set(VEX_RESPONSES),
    );
    expect(new Set(asArray(justificationSchema.enum, "justification enum"))).toEqual(
      new Set(VEX_JUSTIFICATIONS),
    );
    expect(VEX_STATUSES).toHaveLength(6);
    expect(VEX_RESPONSES).toHaveLength(5);
    expect(VEX_JUSTIFICATIONS).toHaveLength(9);
  });

  it("normalizes VEX optional empties, numeric ids, and exact no-content responses", async () => {
    const normalized = normalizeVexDecisionInput({
      findingId: "9223372036854775807",
      status: "NOT_AFFECTED",
      response: "",
      justification: "",
      reason: "",
    });

    expect(normalized).toEqual({
      findingId: "9223372036854775807",
      status: "NOT_AFFECTED",
    });
    expect(() =>
      normalizeVexDecisionInput({ findingId: "finding-1", status: "EXPLOITABLE" }),
    ).toThrowError(expect.objectContaining({ code: "PLATFORM_INVALID_FINDING_ID" }));
    await expect(
      platformFake.setVexStatus({
        projectVersionId: "version-1",
        findingId: "101",
        status: "EXPLOITABLE",
      }),
    ).resolves.toBeUndefined();
    await expect(
      platformFake.clearVexStatus({
        projectVersionId: "version-1",
        findingIds: ["101", "202"],
      }),
    ).resolves.toBeUndefined();
    expect(() =>
      assertRemoteNoContent({
        service: "platform",
        operation: "setVexStatus",
        status: 200,
        bodyBytes: 16,
      }),
    ).toThrowError(expect.objectContaining({ code: "REMOTE_EXPECTED_NO_CONTENT" }));
    expect(() =>
      assertRemoteNoContent({
        service: "platform",
        operation: "clearVexStatus",
        status: 204,
        bodyBytes: 2,
      }),
    ).toThrowError(expect.objectContaining({ code: "REMOTE_EXPECTED_NO_CONTENT" }));
  });

  it("structurally binds bulk VEX numeric ids, order, and limits to OpenAPI", async () => {
    const schemas = objectProperty(
      objectProperty(platformAuthority, "components", "Platform OpenAPI"),
      "schemas",
      "components",
    );
    const bulkRequest = objectProperty(
      schemas,
      "BulkSetFindingStatusV0Request",
      "schemas",
    );
    const findingsSchema = objectProperty(
      objectProperty(bulkRequest, "properties", "bulk request"),
      "findings",
      "bulk request properties",
    );
    const bulkItem = objectProperty(schemas, "BulkSetFindingStatusV0Item", "schemas");
    const findingId = objectProperty(
      objectProperty(bulkItem, "properties", "bulk item"),
      "findingId",
      "bulk item properties",
    );
    const clearRequest = objectProperty(
      schemas,
      "BulkClearFindingStatusV0Request",
      "schemas",
    );
    const clearIds = objectProperty(
      objectProperty(clearRequest, "properties", "clear request"),
      "findingIds",
      "clear request properties",
    );

    expect(findingsSchema.maxItems).toBe(5_000);
    expect(findingId.pattern).toBe("^-?[0-9]+$");
    expect(objectProperty(clearIds, "items", "findingIds").pattern).toBe(
      "^-?[0-9]+$",
    );
    expect(VEX_RESUMABLE_CHUNK_SIZE).toBe(500);
    expect(VEX_PLATFORM_MAX_BATCH_SIZE).toBe(5_000);

    const result = await platformFake.batchSetVexStatus({
      projectVersionId: "version-1",
      findings: [
        { findingId: "101", status: "EXPLOITABLE" },
        {
          findingId: "202",
          status: "NOT_AFFECTED",
          justification: "CODE_NOT_REACHABLE",
        },
      ],
    });
    expect(result.results.map((item) => item.findingId)).toEqual(["101", "202"]);
  });

  it("normalizes offset-, page-, and Forge-backed paging identically", async () => {
    const items = ["one", "two", "three", "four", "five"];
    const platformCalls: number[] = [];
    const assuranceStudioCalls: number[] = [];
    const forgeCalls: number[] = [];
    const page: RemotePageRequest = { pageSize: 2 };

    const platformPages = await collectPages(
      iterateRemotePages(
        page,
        undefined,
        pagingOptions("platform"),
        platformOffsetLoader(items, platformCalls),
      ),
    );
    const assuranceStudioPages = await collectPages(
      iterateRemotePages(
        page,
        undefined,
        pagingOptions("assurance-studio"),
        assuranceStudioPageLoader(items, assuranceStudioCalls),
      ),
    );
    const forgePages = await collectPages(
      iterateRemotePages(
        page,
        undefined,
        pagingOptions("forge-compute"),
        forgeRegistryLoader(items, forgeCalls),
      ),
    );

    expect(platformPages).toEqual(assuranceStudioPages);
    expect(platformPages).toEqual(forgePages);
    expect(platformPages.map((entry) => entry.next)).toEqual([
      expect.any(String),
      expect.any(String),
      null,
    ]);
    expect(platformCalls).toEqual([0, 2, 4]);
    expect(assuranceStudioCalls).toEqual([1, 2, 3]);
    expect(forgeCalls).toEqual([0, 2, 4]);
  });

  it("resumes from opaque continuation without exposing transport vocabulary", async () => {
    const items = ["one", "two", "three", "four"];
    const firstIterator = iterateRemotePages(
      { pageSize: 2 },
      undefined,
      pagingOptions("platform"),
      platformOffsetLoader(items, []),
    )[Symbol.asyncIterator]();
    const first = await firstIterator.next();
    expect(first.done).toBe(false);
    const continuation = first.value?.next;
    expect(continuation).toEqual(expect.any(String));
    expect(continuation).not.toMatch(/offset|cursor|page/i);

    const platformCalls: number[] = [];
    const assuranceStudioCalls: number[] = [];
    const platformRest = await collectPages(
      iterateRemotePages(
        { continuation: continuation ?? undefined },
        undefined,
        pagingOptions("platform"),
        platformOffsetLoader(items, platformCalls),
      ),
    );
    const assuranceStudioRest = await collectPages(
      iterateRemotePages(
        { continuation: continuation ?? undefined },
        undefined,
        pagingOptions("assurance-studio"),
        assuranceStudioPageLoader(items, assuranceStudioCalls),
      ),
    );

    expect(platformRest).toEqual(assuranceStudioRest);
    expect(platformRest.flatMap((entry) => entry.items)).toEqual(["three", "four"]);
    expect(platformCalls).toEqual([2]);
    expect(assuranceStudioCalls).toEqual([2]);
  });

  it("aborts in-flight Platform offset and AS page adapters through one typed path", async () => {
    const adapters = ["platform", "assurance-studio"] as const;

    for (const service of adapters) {
      const controller = new AbortController();
      let calls = 0;
      let secondSignal: AbortSignal | undefined;
      const iterator = iterateRemotePages(
        { pageSize: 1 },
        { signal: controller.signal },
        pagingOptions(service),
        async (request) => {
          calls += 1;
          if (calls === 1) {
            return { items: ["one"], total: 3, hasMore: true };
          }
          secondSignal = request.signal;
          return await new Promise<RemotePageBatch<string>>(() => {});
        },
      )[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({ done: false });
      const pending = iterator.next();
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toMatchObject({
        service,
        code: "REMOTE_ABORTED",
        retryable: false,
      });
      expect(secondSignal).toBe(controller.signal);
    }
  });

  it("fails closed on malformed or inconsistent paging state", async () => {
    await expect(
      collectPages(
        iterateRemotePages(
          { continuation: "offset=20" },
          undefined,
          pagingOptions("platform"),
          platformOffsetLoader(["one"], []),
        ),
      ),
    ).rejects.toMatchObject({ code: "REMOTE_BAD_CONTINUATION" });

    await expect(
      collectPages(
        iterateRemotePages(
          { pageSize: 2 },
          undefined,
          pagingOptions("platform"),
          async () => ({ items: [], total: null, hasMore: true }),
        ),
      ),
    ).rejects.toMatchObject({ code: "REMOTE_EMPTY_NONTERMINAL_PAGE" });
  });

  it("enforces artifact stream, size, hash, and JSON boundaries", async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of artifact.stream()) chunks.push(chunk);

    expect(chunks).toHaveLength(2);
    await expect(artifact.readJson(streamedJson.byteLength)).resolves.toEqual({
      ok: true,
    });
    await expect(artifact.readJson(2)).rejects.toMatchObject({
      code: "REMOTE_ARTIFACT_TOO_LARGE",
    });
    await expect(
      collectBytes(jsonArtifact({ size: streamedJson.byteLength + 1 })),
    ).rejects.toMatchObject({ code: "REMOTE_ARTIFACT_SIZE_MISMATCH" });
    await expect(
      collectBytes(jsonArtifact({ sha256: "0".repeat(64) })),
    ).rejects.toMatchObject({ code: "REMOTE_ARTIFACT_HASH_MISMATCH" });
    expect(artifact).toMatchObject({
      mediaType: "application/json",
      size: streamedJson.byteLength,
      sha256: streamedJsonSha256,
    });
    expect(FIRMWARE_RANGE_MAX_BYTES).toBe(131_072);
    expect(Object.keys(artifact)).not.toContain("filePath");
    expect(Object.keys(artifact)).not.toContain("savedTo");
  });

  it("keeps Forge invocation closed while preserving open job tool metadata", () => {
    const cancelled = normalizeForgeJobSnapshot({
      ...forgeCandidate,
      status: "CANCELLED",
      tool: "future_registry_job",
    });
    const completed = normalizeForgeJobSnapshot({
      ...forgeCandidate,
      status: "COMPLETED",
      tool: "future_registry_job",
    });

    expect(FORGE_JOB_STATUSES).toEqual([
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "TIMEOUT",
    ]);
    expect(FORGE_JOB_TERMINAL_STATUSES).toEqual([
      "COMPLETED",
      "FAILED",
      "TIMEOUT",
    ]);
    expect(cancelled).toMatchObject({
      status: "FAILED",
      tool: "future_registry_job",
      error: { code: "FORGE_JOB_CANCELLED" },
    });
    expect(completed).toMatchObject({
      status: "COMPLETED",
      tool: "future_registry_job",
      error: null,
    });
  });

  it("structurally binds the closed Forge invocation allowlist to the manifest", () => {
    const operations = asArray(
      property(forgeAuthority, "operations", "Forge compute manifest"),
      "Forge operations",
    ).map((operation, index) => asRecord(operation, `Forge operation ${index}`));
    const invocations = operations
      .map((operation) => operation.mcpTool)
      .filter((tool): tool is string => typeof tool === "string");
    const statusOperation = operations.find(
      (operation) => operation.clientMethod === "getJobStatus",
    );
    const listOperation = operations.find(
      (operation) => operation.clientMethod === "listJobs",
    );
    if (!statusOperation || !listOperation) {
      throw new TypeError("Forge job operations are required");
    }

    expect(invocations).toEqual([...FORGE_COMPUTE_INVOCATIONS]);
    expect(
      objectProperty(
        objectProperty(statusOperation, "successResponse", "getJobStatus"),
        "required",
        "getJobStatus.successResponse",
      ).tool,
    ).toBe("string");
    expect(
      objectProperty(
        objectProperty(listOperation, "request", "listJobs"),
        "optional",
        "listJobs.request",
      ).tool,
    ).toBe("string|null");
  });

  it("structurally verifies AS routes and handler-backed exceptions", () => {
    const paths = objectProperty(
      assuranceStudioAuthority,
      "paths",
      "Assurance Studio OpenAPI",
    );
    expect(paths).toHaveProperty(
      "/api/projects/{projectId}/verification/checks",
    );
    expect(paths).toHaveProperty(
      "/api/projects/{projectId}/verification/checks/{checkId}",
    );
    expect(paths).toHaveProperty(
      "/api/projects/{projectId}/verification/run",
    );

    const attackPathRow = parseMarkdownTableRows(assuranceStudioGaps).find(
      (row) => row[0] === "AttackPath item (`/api/projects/{projectId}/attack-paths/{pathId}`)",
    );
    expect(attackPathRow?.[1]).toBe("GET, PATCH, DELETE");
    const sbomSection = parseLevelTwoSections(assuranceStudioGaps).get("6");
    expect(sbomSection?.codeSpans).toContain("GET /api/projects/{id}/sbom");
  });

  it("keeps method evidence complete and the named route surface closed", () => {
    expect(Object.keys(PLATFORM_METHOD_EVIDENCE)).toEqual(Object.keys(platformFake));
    expect(Object.keys(ASSURANCE_STUDIO_METHOD_EVIDENCE)).toEqual(
      Object.keys(assuranceStudioFake),
    );
    expect(Object.keys(FORGE_COMPUTE_METHOD_EVIDENCE)).toEqual(
      Object.keys(forgeComputeFake),
    );
    expect(SECURITY_ASSESSMENT_TOOLS).toHaveLength(10);
  });
});

async function collectBytes(source: RemoteArtifact): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source.stream()) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
