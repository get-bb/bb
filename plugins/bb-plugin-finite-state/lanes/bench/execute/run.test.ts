import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openManifest,
  verifyMountIntegrity,
  type FirmwareManifestMeta,
  type FirmwareNode,
} from "../../firmware/cache/manifest.js";
import { rootfsPath } from "../../firmware/cache/layout.js";
import { prepareFirmwareForBench } from "../../firmware/forge/handshake.js";
import { DIGEST_A, createBenchTestStore } from "../store/test-helpers.js";
import { InMemoryBenchJobQueue } from "./jobs.js";
import {
  BenchRunError,
  persistBenchLog,
  readPersistedBenchLog,
  runBench,
  type BenchExecutionDeps,
  type BenchRunRequest,
} from "./run.js";

const fixtures: Array<ReturnType<typeof createBenchTestStore>> = [];
const roots: string[] = [];

async function* noForgeJobs() {
  yield { items: [], total: 0, next: null };
}

afterEach(async () => {
  await Promise.all([
    ...fixtures
      .splice(0)
      .map((fixture) => fixture.host.harness.lifecycle.dispose()),
    ...roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  ]);
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function preparedFirmwareFixture() {
  const root = await mkdtemp(join(tmpdir(), "fs-run-tier1-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n");
  const rootfs = rootfsPath(root, "version-a");
  await mkdir(join(rootfs, "bin"), { recursive: true });
  await writeFile(join(rootfs, "bin/app"), "verified bytes");
  const node: FirmwareNode = {
    path: "/bin/app",
    kind: "file",
    fileHash: sha256("verified bytes"),
    size: 14,
    mimeType: "application/octet-stream",
    fullType: null,
    unixMode: 0o755,
    unixUid: 0,
    unixGid: 0,
    isSetuid: false,
    isSetgid: false,
    symlinkTarget: null,
    materialized: true,
    errors: [],
  };
  const meta: FirmwareManifestMeta = {
    pvId: "version-a",
    scanId: "scan-a",
    inputSha256: sha256("input"),
    source: "standalone_unpack",
    artifactHash: null,
    fullyMaterialized: true,
    materializedAt: new Date(0).toISOString(),
    nodeCount: 1,
    hydratedCount: 1,
    adminBytesOk: true,
    unpackErrors: [],
    stale: false,
  };
  const manifest = openManifest(root, "version-a");
  try {
    manifest.replaceNodes([node], meta);
    verifyMountIntegrity(manifest);
  } finally {
    manifest.close();
  }
  return {
    root,
    prepared: await prepareFirmwareForBench(
      { worktreeRoot: root },
      "version-a",
      new AbortController().signal,
    ),
  };
}

function enrolledHost() {
  return {
    id: "host-a",
    name: "Bench A",
    type: "persistent" as const,
    status: "connected" as const,
    maxPermissionMode: "full" as const,
    lastSeenAt: 1_000,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function deps(
  fixture: ReturnType<typeof createBenchTestStore>,
): BenchExecutionDeps {
  fixture.host.harness.sdk.stub("hosts.list", async () => [enrolledHost()]);
  fixture.host.harness.sdk.stub("threads.spawn", async () => ({
    id: "thread-a",
  }));
  return {
    bb: fixture.host.bb,
    db: fixture.db,
    hostProbe: {
      inspect: async () => ({
        allowPentest: false,
        docker: false,
        cveEvidenceVerifier: false,
        forgeCompute: false,
      }),
    },
    tier0Analyzers: [
      {
        id: "static-a",
        run: async () => ({
          checkId: "static-a",
          outcome: "pass",
          summary: "explicit pass",
        }),
      },
    ],
    forgeCompute: null,
    scheduler: { sleep: async () => undefined },
    jobQueue: new InMemoryBenchJobQueue(),
    evidence: { persistLog: async () => null },
    assertProjectVersion: async () => ({
      workspacePath: "/workspace",
      firmwareDigest: DIGEST_A,
    }),
    prepareFirmware: async () => {
      throw new Error("not used for tier0");
    },
    resolveTier1Targets: async () => {
      throw new Error("not used for tier0");
    },
    createRunId: () => "run-execute-a",
    now: () => new Date("2026-08-12T20:00:00.000Z"),
    publish: vi.fn(),
  };
}

describe("runBench", () => {
  it("rejects an unaccepted evidence scope before minting an attempt", async () => {
    const fixture = createBenchTestStore("execute-run-invalid-scope");
    fixtures.push(fixture);
    const execution = deps(fixture);
    execution.createRunId = vi.fn(() => "must-not-be-minted");
    await expect(
      runBench(
        execution,
        {
          projectId: "project-a",
          pvId: "unaccepted-version",
          tier: "tier0",
          hostId: "host-a",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("accepted verificationRun generation");
    expect(execution.createRunId).not.toHaveBeenCalled();
    expect(
      fixture.db
        .prepare("SELECT COUNT(*) FROM verification_runs")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it("persists the prepared digest and selected host/thread in frozen columns", async () => {
    const fixture = createBenchTestStore("execute-run-linkage");
    fixtures.push(fixture);
    const started = await runBench(
      deps(fixture),
      {
        projectId: "project-a",
        pvId: "version-a",
        tier: "tier0",
        hostId: "host-a",
      },
      new AbortController().signal,
    );
    expect(started).toMatchObject({
      runId: "run-execute-a",
      threadId: "thread-a",
      firmwareDigest: DIGEST_A,
      jobIds: [],
    });
    expect(
      fixture.db
        .prepare(
          `SELECT host_id, thread_id, firmware_digest, status
           FROM verification_runs WHERE run_id = 'run-execute-a'`,
        )
        .get(),
    ).toEqual({
      host_id: "host-a",
      thread_id: "thread-a",
      firmware_digest: DIGEST_A,
      status: "completed",
    });
  });

  it("records a failed attempt without creating a thread when prepared-root registration is unavailable", async () => {
    const fixture = createBenchTestStore(
      "execute-run-tier1-lifecycle-unavailable",
    );
    fixtures.push(fixture);
    const execution = deps(fixture);
    execution.hostProbe = {
      inspect: async () => ({
        allowPentest: true,
        docker: true,
        cveEvidenceVerifier: true,
        forgeCompute: true,
      }),
    };
    const verifyDynamic = vi.fn(async () => ({ job_id: "unexpected" }));
    const penTestRun = vi.fn(async () => ({ jobId: "unexpected" }));
    execution.forgeCompute = {
      verifyDynamic,
      penTestRun,
      listJobs: noForgeJobs,
      getJobStatus: vi.fn(async () => ({
        jobId: "unexpected",
        status: "RUNNING" as const,
        tool: "verify_dynamic",
        recipe: null,
        scope: {},
        environment: {},
        runId: null,
        elapsedSeconds: 0,
        logTail: [],
        events: [],
        eventCount: 0,
        result: null,
        error: null,
      })),
    };
    execution.prepareFirmware = async () => ({
      prepared: {
        pvId: "version-a",
        rootfsPath: "/prepared/rootfs",
        artifactHash: DIGEST_A,
        manifestGeneration: "generation-a",
        fileCount: 1,
        environment: { FORGE_QEMU_FIRMWARE_version_a: "/prepared/rootfs" },
        preparedAt: "2026-08-12T20:00:00.000Z",
      },
      firmwareHandshake: { worktreeRoot: "/workspace" },
      forgeProcess: { kind: "remote", reason: "no prepared-root registration" },
    });
    execution.resolveTier1Targets = async () => ({
      verdictIds: ["REQ-A"],
      cveId: "CVE-2026-0001",
      componentId: "component-a",
      findingId: null,
    });

    await expect(
      runBench(
        execution,
        {
          projectId: "project-a",
          pvId: "version-a",
          tier: "tier1",
          hostId: "host-a",
          requirementId: "REQ-A",
          target: "CVE-2026-0001@component-a",
          deploymentContext: {
            productType: "gateway",
            networkExposure: "internet",
            regulatory: "CRA",
            deploymentNotes: "Production edge",
            rootComponentName: "Eagle",
            rootComponentType: "firmware",
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "FIRMWARE_REGISTRATION_UNAVAILABLE" });
    expect(
      fixture.db
        .prepare(
          `SELECT status, thread_id, firmware_digest, raw
         FROM verification_runs WHERE run_id = 'run-execute-a'`,
        )
        .get(),
    ).toMatchObject({
      status: "failed",
      thread_id: null,
      firmware_digest: null,
      raw: expect.stringContaining(
        '"failureCode":"FIRMWARE_REGISTRATION_UNAVAILABLE"',
      ),
    });
    expect(
      fixture.db
        .prepare(
          `SELECT outcome, evidence_summary
         FROM verification_results WHERE run_id = 'run-execute-a'`,
        )
        .get(),
    ).toEqual({
      outcome: "error",
      evidence_summary: "no prepared-root registration",
    });
    expect(
      fixture.host.harness.inspection.sdk.callsTo("threads.spawn"),
    ).toHaveLength(0);
    expect(verifyDynamic).not.toHaveBeenCalled();
    expect(penTestRun).not.toHaveBeenCalled();
  });

  it("persists the validated Tier 1 deployment context in run config", async () => {
    const fixture = createBenchTestStore("execute-run-tier1-config");
    fixtures.push(fixture);
    const firmware = await preparedFirmwareFixture();
    const execution = deps(fixture);
    execution.hostProbe = {
      inspect: async () => ({
        allowPentest: true,
        docker: true,
        cveEvidenceVerifier: true,
        forgeCompute: true,
      }),
    };
    execution.forgeCompute = {
      verifyDynamic: vi.fn(async () => ({ job_id: "dynamic-a" })),
      penTestRun: vi.fn(async () => ({ jobId: "pentest-a" })),
      listJobs: noForgeJobs,
      getJobStatus: vi.fn(),
    };
    execution.prepareFirmware = async () => ({
      prepared: firmware.prepared,
      firmwareHandshake: { worktreeRoot: firmware.root },
      forgeProcess: {
        kind: "plugin_owned_stdio",
        hostId: "host-a",
        command: ["forge"],
        start: async () => undefined,
      },
    });
    execution.resolveTier1Targets = async () => ({
      verdictIds: ["REQ-A"],
      cveId: "CVE-2026-0001",
      componentId: "component-a",
      findingId: null,
    });
    const deploymentContext = {
      productType: "gateway",
      networkExposure: "internet",
      regulatory: "CRA",
      deploymentNotes: "Production edge",
      rootComponentName: "Eagle",
      rootComponentType: "firmware",
    };
    await runBench(
      execution,
      {
        projectId: "project-a",
        pvId: "version-a",
        tier: "tier1",
        hostId: "host-a",
        requirementId: "REQ-A",
        target: "CVE-2026-0001@component-a",
        deploymentContext,
      },
      new AbortController().signal,
    );
    expect(
      fixture.db
        .prepare(
          "SELECT config FROM verification_runs WHERE run_id = 'run-execute-a'",
        )
        .pluck()
        .get(),
    ).toBe(JSON.stringify(deploymentContext));
  });

  it("records dispatch ambiguity from the moment a Tier 1 call is issued", async () => {
    const fixture = createBenchTestStore("execute-run-tier1-dispatch-failure");
    fixtures.push(fixture);
    const firmware = await preparedFirmwareFixture();
    const execution = deps(fixture);
    execution.hostProbe = {
      inspect: async () => ({
        allowPentest: true,
        docker: true,
        cveEvidenceVerifier: true,
        forgeCompute: true,
      }),
    };
    execution.forgeCompute = {
      verifyDynamic: vi.fn(async () => {
        throw new Error("Forge dispatch unavailable");
      }),
      penTestRun: vi.fn(),
      listJobs: noForgeJobs,
      getJobStatus: vi.fn(),
    };
    execution.prepareFirmware = async () => ({
      prepared: firmware.prepared,
      firmwareHandshake: { worktreeRoot: firmware.root },
      forgeProcess: {
        kind: "plugin_owned_stdio",
        hostId: "host-a",
        command: ["forge"],
        start: async () => undefined,
      },
    });
    execution.resolveTier1Targets = async () => ({
      verdictIds: ["REQ-A"],
      cveId: "CVE-2026-0001",
      componentId: "component-a",
      findingId: null,
    });
    await expect(
      runBench(
        execution,
        {
          projectId: "project-a",
          pvId: "version-a",
          tier: "tier1",
          hostId: "host-a",
          requirementId: "REQ-A",
          target: "CVE-2026-0001@component-a",
          deploymentContext: {
            productType: "gateway",
            networkExposure: "internet",
            regulatory: "CRA",
            deploymentNotes: "Production edge",
            rootComponentName: "Eagle",
            rootComponentType: "firmware",
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "FORGE_DISPATCH_AMBIGUOUS",
      message: "Forge dispatch unavailable",
      runId: "run-execute-a",
    });
    const row = fixture.db
      .prepare(
        `SELECT status, firmware_digest, raw
           FROM verification_runs WHERE run_id = 'run-execute-a'`,
      )
      .get() as { status: string; firmware_digest: string; raw: string };
    expect(row).toMatchObject({
      status: "running",
      firmware_digest: firmware.prepared.artifactHash,
    });
    expect(JSON.parse(row.raw)).toMatchObject({
      firmwareDigest: firmware.prepared.artifactHash,
      dispatchError: "Forge dispatch unavailable",
      dispatchAmbiguous: true,
      failureCode: "FORGE_DISPATCH_AMBIGUOUS",
      jobIds: [],
      dispatchIntents: [
        expect.objectContaining({ tool: "verify_dynamic", priorJobIds: [] }),
      ],
    });
    expect(
      fixture.db
        .prepare(
          `SELECT check_id, outcome, evidence_summary
             FROM verification_results WHERE run_id = 'run-execute-a'`,
        )
        .all(),
    ).toEqual([
      {
        check_id: null,
        outcome: "error",
        evidence_summary: "Forge dispatch unavailable",
      },
    ]);
  });

  it("rejects tiers 2-4 explicitly before any host or persistence call", async () => {
    const fixture = createBenchTestStore("execute-run-tier-reject");
    fixtures.push(fixture);
    const request: BenchRunRequest = {
      projectId: "project-a",
      pvId: "version-a",
      tier: "tier0",
      hostId: "host-a",
    };
    Object.defineProperty(request, "tier", { value: "tier3" });
    await expect(
      runBench(deps(fixture), request, new AbortController().signal),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BenchRunError>>({
        code: "TIER_NOT_IMPLEMENTED",
      }),
    );
    expect(
      fixture.db
        .prepare("SELECT COUNT(*) FROM verification_runs")
        .pluck()
        .get(),
    ).toBe(0);
    expect(
      fixture.host.harness.inspection.sdk.callsTo("hosts.list"),
    ).toHaveLength(0);
  });
});

describe("persistBenchLog", () => {
  it("writes a bounded cached tail to the logical locator it returns", async () => {
    const values = new Map<string, unknown>();
    const kv = {
      async set(key: string, value: unknown) {
        values.set(key, value);
      },
      async delete(key: string) {
        values.delete(key);
      },
      async get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
    };
    const locator = await persistBenchLog(
      kv,
      "run-a",
      { jobId: "job-a", logTail: ["x".repeat(300 * 1024), "last line"] },
      new AbortController().signal,
    );
    expect(locator).toBe("runs/run-a/jobs/job-a.log");
    const persisted = await readPersistedBenchLog(kv, locator!);
    expect(persisted?.text.endsWith("last line\n")).toBe(true);
    expect(
      Buffer.byteLength(persisted?.text ?? "", "utf8"),
    ).toBeLessThanOrEqual(240 * 1024);
    expect(persisted?.complete).toBe(false);
  });

  it("removes a partial write and returns no locator when persistence fails", async () => {
    const values = new Map<string, unknown>();
    const kv = {
      async set(key: string, value: unknown) {
        values.set(key, value);
        throw new Error("storage unavailable after write");
      },
      async delete(key: string) {
        values.delete(key);
      },
    };
    await expect(
      persistBenchLog(
        kv,
        "run-a",
        { jobId: "job-a", logTail: ["partial"] },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    expect(values).toEqual(new Map());
  });
});
