import { afterEach, describe, expect, it, vi } from "vitest";
import { DIGEST_A, createBenchTestStore } from "../store/test-helpers.js";
import { InMemoryBenchJobQueue } from "./jobs.js";
import {
  BenchRunError,
  runBench,
  type BenchExecutionDeps,
  type BenchRunRequest,
} from "./run.js";

const fixtures: Array<ReturnType<typeof createBenchTestStore>> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.host.harness.lifecycle.dispose()));
});

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

function deps(fixture: ReturnType<typeof createBenchTestStore>): BenchExecutionDeps {
  fixture.host.harness.sdk.stub("hosts.list", async () => [enrolledHost()]);
  fixture.host.harness.sdk.stub("threads.spawn", async () => ({ id: "thread-a" }));
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
        run: async () => ({ checkId: "static-a", outcome: "pass", summary: "explicit pass" }),
      },
    ],
    forgeCompute: null,
    scheduler: { sleep: async () => undefined },
    jobQueue: new InMemoryBenchJobQueue(),
    evidence: { persistLog: async () => null },
    assertProjectVersion: async () => ({ workspacePath: "/workspace", firmwareDigest: DIGEST_A }),
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

  it("fails closed before creating a run or thread when prepared-root registration is unavailable", async () => {
    const fixture = createBenchTestStore("execute-run-tier1-lifecycle-unavailable");
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
    expect(fixture.db.prepare("SELECT COUNT(*) FROM verification_runs").pluck().get()).toBe(0);
    expect(fixture.host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
    expect(verifyDynamic).not.toHaveBeenCalled();
    expect(penTestRun).not.toHaveBeenCalled();
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
      expect.objectContaining<Partial<BenchRunError>>({ code: "TIER_NOT_IMPLEMENTED" }),
    );
    expect(fixture.db.prepare("SELECT COUNT(*) FROM verification_runs").pluck().get()).toBe(0);
    expect(fixture.host.harness.inspection.sdk.callsTo("hosts.list")).toHaveLength(0);
  });
});
