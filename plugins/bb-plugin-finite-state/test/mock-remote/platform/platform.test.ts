import { createHash } from "node:crypto";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PlatformClient } from "../../../lib/remote/platform/client.js";
import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_RESUMABLE_CHUNK_SIZE,
  VEX_STATUSES,
  type Json,
} from "../../../lib/remote/types.js";
import { createMockRemote, type MockRemoteHarness } from "../server.js";
import { registerPlatformHandlers } from "./register.js";
import {
  createMockPlatformState,
  MockPlatformFixtureError,
  type MockPlatformState,
} from "./state.js";

const FIXTURE_ROOT = resolve(import.meta.dirname, "../fixtures");
const TOKEN = "platform-test-token";
const harnesses: MockRemoteHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

function setup(): {
  state: MockPlatformState;
  harness: MockRemoteHarness;
  client: PlatformClient;
} {
  const state = createMockPlatformState(FIXTURE_ROOT);
  const harness = createMockRemote({
    platformToken: TOKEN,
    assuranceStudioKey: "unused-as-key",
    fixtureRoot: FIXTURE_ROOT,
    register(service, registry) {
      if (service === "platform") registerPlatformHandlers(registry, state);
    },
  });
  harnesses.push(harness);
  return {
    state,
    harness,
    client: new PlatformClient({ baseUrl: "http://platform.mock", token: TOKEN, fetch: harness.platform.fetch }),
  };
}

async function collect<T>(pages: AsyncIterable<{ items: T[] }>): Promise<T[]> {
  const values: T[] = [];
  for await (const page of pages) values.push(...page.items);
  return values;
}

async function artifactBytes(artifact: { stream(): AsyncIterable<Uint8Array> }): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of artifact.stream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function request(path: string, init?: RequestInit): [string, RequestInit] {
  return [
    `http://platform.mock${path}`,
    { ...init, headers: { "X-Authorization": TOKEN, ...(init?.headers ?? {}) } },
  ];
}

describe("mock-direct-platform-data", () => {
  it("projects, versions, and findings page deterministically using the audited raw shapes", async () => {
    const { client, harness, state } = setup();
    const projectId = state.projects.keys().next().value;
    const projectVersionId = [...state.versions.values()].find((version) => version.priorVersionId !== null)?.id;
    expect(typeof projectId).toBe("string");
    expect(typeof projectVersionId).toBe("string");

    expect(await collect(client.listProjects({ pageSize: 1 }))).toEqual([...state.projects.values()]);
    expect(await collect(client.listVersions(String(projectId), { pageSize: 1 }))).toEqual([...state.versions.values()]);
    const findings = await collect(client.getFindings({
      projectVersionId: String(projectVersionId),
      page: { pageSize: 777 },
    }));
    expect(findings).toHaveLength(4_001);
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(4_000);
    expect(findings.map((finding) => finding.id)).toEqual(
      [...state.findings.values()].map((finding) => finding.id),
    );

    const [url, init] = request("/public/v0/findings?offset=0&limit=2");
    const response = await harness.platform.fetch(url, init);
    const raw: unknown = await response.json();
    expect(Array.isArray(raw)).toBe(true);
    expect(response.headers.get("x-offset")).toBe("0");
    expect(JSON.stringify(raw)).not.toMatch(/file_path|preview|saved_to|continuation/u);
  });

  it("binds all four reviewed findings-summary routes through PlatformClient", async () => {
    const { client, state } = setup();
    const projectVersionId = String(
      [...state.versions.values()].find((version) => version.priorVersionId !== null)?.id,
    );
    await expect(client.getFindingsSummary(projectVersionId)).resolves.toEqual({
      exploit: {
        withExploit: 0,
        withoutExploit: 4_000,
        byExploit: {},
        total: 4_000,
      },
      status: expect.objectContaining({ total: 4_000 }),
      category: { byCategory: { CVE: 4_000 }, total: 4_000 },
      severity: {
        bySeverity: { critical: 1_000, high: 1_000, medium: 1_000, low: 1_000 },
        total: 4_000,
      },
    });
  });

  it("missing or corrupt fixtures fail with a typed error before state is exposed", async () => {
    expect(() => createMockPlatformState(resolve(tmpdir(), "fixture-root-does-not-exist"))).toThrow(
      MockPlatformFixtureError,
    );
    const root = await mkdtemp(resolve(tmpdir(), "fs-platform-fixtures-"));
    await cp(FIXTURE_ROOT, root, { recursive: true });
    await writeFile(resolve(root, "platform/findings.jsonl"), "{corrupt\n", "utf8");
    expect(() => createMockPlatformState(root)).toThrowError(
      expect.objectContaining({ code: "MOCK_PLATFORM_FIXTURE_INVALID" }),
    );
  });

  it("validates exact VEX vocabulary and rejects transport dry-run without mutation", async () => {
    const { harness, state } = setup();
    expect(VEX_STATUSES).toEqual([
      "EXPLOITABLE", "IN_TRIAGE", "NOT_AFFECTED", "FALSE_POSITIVE", "RESOLVED", "RESOLVED_WITH_PEDIGREE",
    ]);
    expect(VEX_RESPONSES).toHaveLength(5);
    expect(VEX_JUSTIFICATIONS).toHaveLength(9);
    const finding = state.findings.values().next().value;
    const projectVersionId = String(finding?.projectVersionId);
    const findingId = String(finding?.id);
    const before = state.snapshot();
    const [dryUrl, dryInit] = request(
      `/public/v0/findings/${projectVersionId}/${findingId}/status`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "NOT_AFFECTED", dryRun: true }),
      },
    );
    const dryRun = await harness.platform.fetch(dryUrl, dryInit);
    expect(dryRun.status).toBe(400);
    expect(state.snapshot()).toEqual(before);

    for (const status of VEX_STATUSES) {
      const [url, init] = request(
        `/public/v0/findings/${projectVersionId}/${findingId}/status`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      expect((await harness.platform.fetch(url, init)).status).toBe(204);
      expect(state.vexTuple(projectVersionId, findingId)?.status).toBe(status);
    }
    const [invalidUrl, invalidInit] = request(
      `/public/v0/findings/${projectVersionId}/${findingId}/status`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "NOT_EXPLOITABLE" }),
      },
    );
    expect((await harness.platform.fetch(invalidUrl, invalidInit)).status).toBe(400);
  });

  it("bulk VEX preserves ordered partial results and mutates successful rows only", async () => {
    const { client, state } = setup();
    const findings = [...state.findings.values()].slice(0, 5);
    const projectVersionId = String(findings[0]?.projectVersionId);
    const before = findings.map((finding) => state.vexTuple(projectVersionId, String(finding.id)));
    const result = await client.batchSetVexStatus({
      projectVersionId,
      findings: findings.map((finding) => ({
        findingId: String(finding.id),
        status: "NOT_AFFECTED",
        response: "WILL_NOT_FIX",
        justification: "CODE_NOT_REACHABLE",
      })),
    });
    expect(result).toMatchObject({
      status: "partial_success",
      summary: { total: 5, succeeded: 3, failed: 2 },
    });
    expect(result.results.map((item) => item.findingId)).toEqual(findings.map((finding) => finding.id));
    expect(result.results.map((item) => item.success)).toEqual([true, true, true, false, false]);
    expect(findings.slice(0, 3).map((finding) => state.vexTuple(projectVersionId, String(finding.id))?.status)).toEqual([
      "NOT_AFFECTED", "NOT_AFFECTED", "NOT_AFFECTED",
    ]);
    expect(findings.slice(3).map((finding) => state.vexTuple(projectVersionId, String(finding.id)))).toEqual(before.slice(3));
  });

  it("clears VEX for an owning version and rejects a foreign version", async () => {
    const { client, harness, state } = setup();
    const finding = state.findings.values().next().value;
    const projectVersionId = String(finding?.projectVersionId);
    const findingId = String(finding?.id);
    expect(state.vexTuple(projectVersionId, findingId)?.status).toBe("IN_TRIAGE");
    await expect(client.clearVexStatus({ projectVersionId, findingIds: [findingId] })).resolves.toBeUndefined();
    expect(state.vexTuple(projectVersionId, findingId)).toEqual({
      status: null,
      response: null,
      justification: null,
      reason: null,
    });
    await harness.reset("platform");
    const clearRequest = {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findingIds: [findingId] }),
    } satisfies RequestInit;
    const [clearUrl, clearInit] = request(
      `/public/v0/findings/${projectVersionId}/status/clear/bulk`,
      clearRequest,
    );
    expect((await harness.platform.fetch(clearUrl, clearInit)).status).toBe(204);
    const [foreignUrl, foreignInit] = request(
      "/public/v0/findings/pv-does-not-exist/status/clear/bulk",
      clearRequest,
    );
    expect((await harness.platform.fetch(foreignUrl, foreignInit)).status).toBe(404);
  });

  it("applies single and bulk VEX decisions to every physical duplicate UUID row", async () => {
    const { client, harness, state } = setup();
    const projectVersionId = "pv-a481df87dadf";
    const findingId = "8000000000000000027";
    const duplicates = () => [...state.findings.values()].filter(
      (finding) => finding.projectVersionId === projectVersionId && finding.id === findingId,
    );
    expect(duplicates()).toHaveLength(2);
    await client.setVexStatus({ projectVersionId, findingId, status: "RESOLVED" });
    expect(duplicates().map((finding) => finding.vexStatus)).toEqual(["RESOLVED", "RESOLVED"]);
    await harness.reset("platform");
    await client.batchSetVexStatus({
      projectVersionId,
      findings: [{ findingId, status: "FALSE_POSITIVE" }],
    });
    expect(duplicates().map((finding) => finding.vexStatus)).toEqual([
      "FALSE_POSITIVE",
      "FALSE_POSITIVE",
    ]);
  });

  it("freezes the upstream 5000 ceiling separately from the 500-row planner chunk", async () => {
    const { harness } = setup();
    expect(VEX_RESUMABLE_CHUNK_SIZE).toBe(500);
    const findings = Array.from({ length: 5_001 }, (_, index) => ({
      findingId: String(8_000_000_000_000_000_000n + BigInt(index)),
      status: "IN_TRIAGE",
    }));
    const send = (count: number) => {
      const [url, init] = request(
        "/public/v0/findings/pv-a481df87dadf/status/set/bulk",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ findings: findings.slice(0, count) }),
        },
      );
      return harness.platform.fetch(url, init);
    };
    expect((await send(5_000)).status).toBe(200);
    expect((await send(5_001)).status).toBe(400);
  });

  it("activity and comments preserve version membership and reject foreign ids", async () => {
    const { client, state } = setup();
    const projectId = String(state.projects.keys().next().value);
    const versions = [...state.versions.values()];
    const currentVersionId = String(versions.find((version) => version.priorVersionId !== null)?.id);
    const priorVersionId = String(versions.find((version) => version.priorVersionId === null)?.id);
    const detailFinding = [...state.findings.values()].find(
      (finding) => state.findingComments.get(currentVersionId) &&
        [...state.findingComments.get(currentVersionId)!.values()].some((comment) => comment.findingId === finding.id),
    );
    expect(detailFinding).toBeDefined();
    expect([...state.findingComments.keys()]).toEqual([currentVersionId]);
    expect(state.findingComments.has(priorVersionId)).toBe(false);
    expect(await collect(client.listFindingComments({
      projectVersionId: currentVersionId,
      findingId: String(detailFinding?.id),
    }))).toHaveLength(1);
    expect(await client.getFindingDetail({
      projectVersionId: currentVersionId,
      findingId: String(detailFinding?.id),
    })).toHaveProperty("cves");
    await expect(collect(client.listFindingComments({
      projectVersionId: priorVersionId,
      findingId: String(detailFinding?.id),
    }))).rejects.toMatchObject({ status: 404 });

    const [activity] = state.findingActivity.values();
    const cve = String(activity?.[0]?.cve);
    expect(await collect(client.getFindingActivity({
      projectId,
      projectVersionId: currentVersionId,
      cve,
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "soft_delete" }),
      expect.objectContaining({ action: "upstream_reconfirm" }),
    ]));
    expect(await collect(client.getFindingActivity({
      projectId,
      projectVersionId: priorVersionId,
      cve,
    }))).toEqual([]);
    await expect(collect(client.getFindingActivity({
      projectId: "foreign-project",
      projectVersionId: currentVersionId,
      cve,
    }))).rejects.toMatchObject({ status: 404 });
  });

  it("streams the frozen SBOM hash and resolves all purl and fallback component identities", async () => {
    const { client, state } = setup();
    const projectVersionId = String([...state.versions.values()].find((version) => version.priorVersionId !== null)?.id);
    const artifact = await client.downloadSbom({ projectVersionId, format: "cyclonedx", includeVex: true });
    const joined = await artifactBytes(artifact);
    expect(artifact.mediaType).toBe("application/vnd.cyclonedx+json");
    expect(artifact.size).toBe(joined.byteLength);
    expect(artifact.sha256).toBe(createHash("sha256").update(joined).digest("hex"));
    const sbom = JSON.parse(joined.toString("utf8")) as {
      components: Array<Record<string, Json>>;
      metadata: { component: { version: string }; properties: Json[] };
      vulnerabilities: Json[];
    };
    expect(sbom.components).toHaveLength(900);
    expect(new Set(sbom.components.map((component) => component["bom-ref"]))).toEqual(new Set(state.components.keys()));
    expect(sbom.metadata.component.version).toBe("2.4.0");
    expect(sbom.vulnerabilities.length).toBeGreaterThan(0);

    const withoutVex = await client.downloadSbom({ projectVersionId, format: "cyclonedx", includeVex: false });
    const withoutVexBytes = await artifactBytes(withoutVex);
    expect(withoutVex.sha256).not.toBe(artifact.sha256);
    expect(JSON.parse(withoutVexBytes.toString("utf8"))).not.toHaveProperty("vulnerabilities");
    const priorVersionId = String([...state.versions.values()].find((version) => version.priorVersionId === null)?.id);
    const prior = await client.downloadSbom({ projectVersionId: priorVersionId, format: "cyclonedx", includeVex: true });
    expect(prior.sha256).not.toBe(artifact.sha256);

    const spdx = await client.downloadSbom({ projectVersionId, format: "spdx", includeVex: false });
    expect(spdx.mediaType).toBe("application/spdx+json");
    expect((await spdx.readJson<{ packages: Json[] }>(1_000_000)).packages).toHaveLength(900);

    const withoutPurl = [...state.components.values()].find((component) => component.purl === null);
    expect(withoutPurl?.fallbackIdentity).toMatch(/^sha256:/u);
    expect(await collect(client.searchComponents({ name: String(withoutPurl?.name), version: String(withoutPurl?.version) }))).toEqual([
      expect.objectContaining({ id: withoutPurl?.id, purl: null }),
    ]);
    const withPurl = [...state.components.values()].find((component) => typeof component.purl === "string");
    expect(await collect(client.listComponents({ filter: `name==${String(withPurl?.name)}` }))).toEqual([
      expect.objectContaining({ id: withPurl?.id, purl: withPurl?.purl }),
    ]);
  });

  it("filters components by excluded and manual-edit state without losing corpus identities", async () => {
    const { client } = setup();
    const included = await collect(client.listComponents({ excluded: false }));
    const excluded = await collect(client.listComponents({ excluded: true }));
    const edited = await collect(client.listComponents({ excluded: false, editStatus: "edited" }));
    const unedited = await collect(client.listComponents({ excluded: false, editStatus: "unedited" }));
    expect(included).toHaveLength(899);
    expect(excluded).toEqual([expect.objectContaining({ excluded: true })]);
    expect(edited).toEqual([
      expect.objectContaining({ id: "component-0002", edited: true }),
    ]);
    expect(unedited).toHaveLength(898);
    expect(new Set([...included, ...excluded].map((component) => component.id)).size).toBe(900);
  });

  it("reset restores byte-equivalent logical state", async () => {
    const { client, harness, state } = setup();
    const finding = state.findings.values().next().value;
    const projectVersionId = String(finding?.projectVersionId);
    const findingId = String(finding?.id);
    const before = JSON.stringify(state.snapshot());
    await client.setVexStatus({ projectVersionId, findingId, status: "RESOLVED", reason: "fixture mutation" });
    expect(JSON.stringify(state.snapshot())).not.toBe(before);
    await harness.reset("platform");
    expect(JSON.stringify(state.snapshot())).toBe(before);
  });
});
