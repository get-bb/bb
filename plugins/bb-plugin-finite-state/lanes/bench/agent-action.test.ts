import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import type {
  ForgeJobSnapshot,
  Json,
  RemoteServices,
} from "../../lib/remote/types.js";
import {
  BENCH_DISPATCH_RECONCILIATION_FAILED_CODE,
  BENCH_DISPATCH_RECONCILED_CODE,
} from "./ambiguity.js";
import { registerActionTools } from "../agentic/tools/actions.js";
import {
  openManifest,
  verifyMountIntegrity,
  type FirmwareManifestMeta,
  type FirmwareNode,
} from "../firmware/cache/manifest.js";
import { rootfsPath } from "../firmware/cache/layout.js";
import { computeForgeArtifactHash } from "../firmware/forge/artifact-hash.js";
import { prepareFirmwareForBench } from "../firmware/forge/handshake.js";
import { registerRemoteServices } from "../remote/register.js";
import { registerBenchAgentAction } from "./agent-action.js";
import { createDefaultBenchExecutionDeps } from "./execute/run.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type FakeHost = ReturnType<typeof createFakePluginHost>;

function decoded(
  result: Awaited<ReturnType<FakeHost["harness"]["behavior"]["callAgentTool"]>>,
): unknown {
  if (typeof result === "string") return JSON.parse(result) as unknown;
  const text = result.content.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("Tool returned no text");
  return JSON.parse(text) as unknown;
}

async function writeReadyMount(root: string): Promise<string> {
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n");
  const rootfs = rootfsPath(root, "pv-1");
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
    pvId: "pv-1",
    scanId: "scan-1",
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
  const manifest = openManifest(root, "pv-1");
  try {
    manifest.replaceNodes([node], meta);
    verifyMountIntegrity(manifest);
  } finally {
    manifest.close();
  }
  return (await computeForgeArtifactHash(rootfs, new AbortController().signal))
    .artifactHash;
}

describe("registered bench agent action", () => {
  it("returns the durable failed run identity without widening the frozen tool surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-agent-bench-attempt-"));
    roots.push(root);
    const artifactHash = await writeReadyMount(root);
    const host = createFakePluginHost({
      pluginId: `fs-action-bench-attempt-${crypto.randomUUID()}`,
    });
    hosts.push(host);
    host.harness.sdk.stub("threads.get", async () => ({
      id: "thread-test",
      projectId: "project-test",
      environmentId: "environment-test",
    }));
    host.harness.sdk.stub("environments.get", async () => ({
      id: "environment-test",
      projectId: "project-test",
      path: root,
      hostId: "host-test",
    }));
    host.harness.sdk.stub("projects.get", async () => ({
      id: "project-test",
      kind: "standard",
      name: "Project Test",
      gitRemoteUrl: null,
      createdAt: 1,
      updatedAt: 1,
      sources: [
        {
          id: "source-test",
          projectId: "project-test",
          type: "local_path",
          hostId: "host-test",
          path: root,
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }));
    host.harness.sdk.stub("hosts.list", async () => []);
    const ctx = createPluginContext(host.bb);
    await registerRemoteServices(host.bb, ctx);
    const at = "2026-08-14T04:30:00.000Z";
    ctx
      .db()
      .prepare(
        `INSERT INTO pull_generation
          (project_id, project_version_id, generation_id, status,
           requested_kinds_json, started_at, accepted_at)
         VALUES ('project-test', 'pv-1', 'generation-1', 'accepted',
                 '["verificationRun"]', ?, ?)`,
      )
      .run(at, at);
    ctx
      .db()
      .prepare(
        `INSERT INTO sync_state
          (project_id, project_version_id, entity_kind,
           accepted_generation_id, last_pull)
         VALUES ('project-test', 'pv-1', 'verificationRun',
                 'generation-1', ?)`,
      )
      .run(at);
    ctx
      .db()
      .prepare(
        `INSERT INTO firmware_mounts
          (project_id, project_version_id, generation_id, source, state,
           input_sha256, artifact_hash, root_path, file_count,
           materialized_files, error_count, pulled_at)
         VALUES ('project-test', 'pv-1', 'generation-1', 'standalone_unpack',
                 'ready', ?, ?, ?, 1, 1, 0, ?)`,
      )
      .run(sha256("input"), artifactHash, rootfsPath(root, "pv-1"), at);
    registerBenchAgentAction(
      ctx,
      () =>
        ctx.service<RemoteServices>("remote-services", () => {
          throw new Error("REMOTE_SERVICES_NOT_REGISTERED");
        }),
      {
        enqueue: vi.fn(),
        take: vi.fn(async () => {
          throw new Error("No queued bench job");
        }),
      },
    );
    registerActionTools(host.bb, ctx);

    const result = await host.harness.behavior.callAgentTool(
      "fs_bench_run",
      { pvId: "pv-1", tier: "tier0" },
      { projectId: "project-test", threadId: "thread-test" },
    );
    const failed = ctx
      .db()
      .prepare<
        [],
        { run_id: string; status: string }
      >("SELECT run_id, status FROM verification_runs WHERE project_id='project-test'")
      .get();
    expect(failed).toEqual({
      run_id: expect.stringMatching(/^bench-/u),
      status: "failed",
    });
    if (!failed) throw new Error("Expected one durable failed bench run");
    expect(decoded(result)).toMatchObject({
      ok: false,
      error: {
        code: "HOST_NOT_ENROLLED",
        hint: "Fix the selected firmware mount or bench prerequisites before retrying.",
        details: { runId: failed.run_id },
      },
    });
    expect(host.harness.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it.each([
    {
      name: "pen-test dispatch fails after a parsed verify job",
      mode: "pen_failure" as const,
      expectedInitialJobId: "dynamic-live-1",
      expectedPenCalls: 1,
      reconciliationFailures: 0,
      expectedReconciliationAttempts: 1,
      enqueueFailure: false,
      terminalFailure: null,
    },
    {
      name: "verify dispatch returns no parseable job id",
      mode: "malformed_verify" as const,
      expectedInitialJobId: null,
      expectedPenCalls: 0,
      reconciliationFailures: 0,
      expectedReconciliationAttempts: 1,
      enqueueFailure: false,
      terminalFailure: null,
    },
    {
      name: "verify transport fails after Forge accepts the job",
      mode: "verify_transport" as const,
      expectedInitialJobId: null,
      expectedPenCalls: 0,
      reconciliationFailures: 1,
      expectedReconciliationAttempts: 2,
      enqueueFailure: false,
      terminalFailure: null,
    },
    {
      name: "reconciliation exhausts its retry budget",
      mode: "verify_transport" as const,
      expectedInitialJobId: null,
      expectedPenCalls: 0,
      reconciliationFailures: 3,
      expectedReconciliationAttempts: 0,
      enqueueFailure: false,
      terminalFailure: "retry_exhausted" as const,
    },
    {
      name: "a reconciled job remains running for 900 polls",
      mode: "verify_transport" as const,
      expectedInitialJobId: null,
      expectedPenCalls: 0,
      reconciliationFailures: 0,
      expectedReconciliationAttempts: 0,
      enqueueFailure: false,
      terminalFailure: "poll_limit" as const,
    },
    {
      name: "the reconciliation task cannot be queued",
      mode: "verify_transport" as const,
      expectedInitialJobId: null,
      expectedPenCalls: 0,
      reconciliationFailures: 0,
      expectedReconciliationAttempts: 0,
      enqueueFailure: true,
      terminalFailure: null,
    },
  ])(
    "preserves ambiguity when $name",
    async ({
      mode,
      expectedInitialJobId,
      expectedPenCalls,
      reconciliationFailures,
      expectedReconciliationAttempts,
      enqueueFailure,
      terminalFailure,
    }) => {
      const root = await mkdtemp(join(tmpdir(), "fs-agent-bench-ambiguous-"));
      roots.push(root);
      const artifactHash = await writeReadyMount(root);
      const prepared = await prepareFirmwareForBench(
        { worktreeRoot: root },
        "pv-1",
        new AbortController().signal,
      );
      const host = createFakePluginHost({
        pluginId: `fs-action-bench-ambiguous-${crypto.randomUUID()}`,
      });
      hosts.push(host);
      host.harness.sdk.stub("threads.get", async () => ({
        id: "thread-test",
        projectId: "project-test",
        environmentId: "environment-test",
      }));
      host.harness.sdk.stub("threads.spawn", async () => ({
        id: "bench-thread-ambiguous",
      }));
      host.harness.sdk.stub("environments.get", async () => ({
        id: "environment-test",
        projectId: "project-test",
        path: root,
        hostId: "host-test",
      }));
      host.harness.sdk.stub("projects.get", async () => ({
        id: "project-test",
        kind: "standard",
        name: "Project Test",
        gitRemoteUrl: null,
        createdAt: 1,
        updatedAt: 1,
        sources: [
          {
            id: "source-test",
            projectId: "project-test",
            type: "local_path",
            hostId: "host-test",
            path: root,
            isDefault: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }));
      host.harness.sdk.stub("hosts.list", async () => [
        {
          id: "host-test",
          name: "Bench Test",
          type: "persistent",
          status: "connected",
          maxPermissionMode: "full",
          lastSeenAt: 1,
          lastRejectedProtocolVersion: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]);
      const ctx = createPluginContext(host.bb);
      await registerRemoteServices(host.bb, ctx);
      const at = "2026-08-14T04:30:00.000Z";
      ctx
        .db()
        .prepare(
          `INSERT INTO pull_generation
        (project_id, project_version_id, generation_id, status,
         requested_kinds_json, started_at, accepted_at)
       VALUES ('project-test', 'pv-1', 'generation-1', 'accepted',
               '["verificationRun"]', ?, ?)`,
        )
        .run(at, at);
      ctx
        .db()
        .prepare(
          `INSERT INTO sync_state
        (project_id, project_version_id, entity_kind,
         accepted_generation_id, last_pull)
       VALUES ('project-test', 'pv-1', 'verificationRun',
               'generation-1', ?)`,
        )
        .run(at);
      ctx
        .db()
        .prepare(
          `INSERT INTO firmware_mounts
        (project_id, project_version_id, generation_id, source, state,
         input_sha256, artifact_hash, root_path, file_count,
         materialized_files, error_count, pulled_at)
       VALUES ('project-test', 'pv-1', 'generation-1', 'standalone_unpack',
               'ready', ?, ?, ?, 1, 1, 0, ?)`,
        )
        .run(sha256("input"), artifactHash, rootfsPath(root, "pv-1"), at);
      let verifyIssued = false;
      const acceptedJob: ForgeJobSnapshot = {
        jobId: "dynamic-live-1",
        status: "COMPLETED",
        tool: "verify_dynamic",
        recipe: null,
        scope: { projectVersionId: "pv-1", verdictIds: ["REQ-1"] },
        environment: {},
        runId: null,
        elapsedSeconds: 1,
        logTail: [],
        events: [],
        eventCount: 0,
        result: null,
        error: null,
      };
      const verifyDynamic = vi.fn(async (): Promise<Json> => {
        verifyIssued = true;
        if (mode === "verify_transport") throw new Error("socket hang up");
        return mode === "malformed_verify" ? {} : { job_id: "dynamic-live-1" };
      });
      const penTestRun = vi.fn(async () => {
        throw new Error("pen-test dispatch transport closed");
      });
      const getJobStatus = vi.fn(
        async (): Promise<ForgeJobSnapshot> => ({
          ...acceptedJob,
          status: terminalFailure === "poll_limit" ? "RUNNING" : "COMPLETED",
        }),
      );
      let reconciliationFailuresRemaining = reconciliationFailures;
      let reconciliationListAttempts = 0;
      const reconciliationStatesSeenDuringSleep: unknown[] = [];
      let reconciliationTask:
        | { run(signal: AbortSignal): Promise<void> }
        | undefined;
      const jobQueue = {
        enqueue: vi.fn((task: { run(signal: AbortSignal): Promise<void> }) => {
          if (enqueueFailure) throw new Error("bench queue unavailable");
          reconciliationTask = task;
        }),
        take: vi.fn(async () => {
          throw new Error("No queued bench job");
        }),
      };
      registerBenchAgentAction(
        ctx,
        () =>
          ctx.service<RemoteServices>("remote-services", () => {
            throw new Error("REMOTE_SERVICES_NOT_REGISTERED");
          }),
        jobQueue,
        (ownerCtx, request, remote, queue) => {
          request.deploymentContext = {
            productType: "gateway",
            networkExposure: "internet",
            regulatory: "CRA",
            deploymentNotes: "Production edge",
            rootComponentName: "Eagle",
            rootComponentType: "firmware",
          };
          return {
            ...createDefaultBenchExecutionDeps(
              ownerCtx,
              request,
              remote,
              queue,
            ),
            scheduler: {
              sleep: async () => {
                const current = ctx
                  .db()
                  .prepare(
                    "SELECT raw FROM verification_runs WHERE run_id='bench-ambiguous-1'",
                  )
                  .get() as { raw: string } | undefined;
                if (current) {
                  reconciliationStatesSeenDuringSleep.push(
                    (JSON.parse(current.raw) as Record<string, unknown>)[
                      "reconciliationState"
                    ],
                  );
                }
              },
            },
            hostProbe: {
              inspect: async () => ({
                allowPentest: true,
                docker: true,
                cveEvidenceVerifier: true,
                forgeCompute: true,
              }),
            },
            forgeCompute: {
              verifyDynamic,
              penTestRun,
              getJobStatus,
              listJobs(input) {
                return {
                  async *[Symbol.asyncIterator]() {
                    if (verifyIssued) reconciliationListAttempts += 1;
                    if (verifyIssued && reconciliationFailuresRemaining > 0) {
                      reconciliationFailuresRemaining -= 1;
                      throw new Error("transient list_jobs outage");
                    }
                    const matchesTool = input?.tool === acceptedJob.tool;
                    yield {
                      items: verifyIssued && matchesTool ? [acceptedJob] : [],
                      total: verifyIssued && matchesTool ? 1 : 0,
                      next: null,
                    };
                  },
                };
              },
            },
            prepareFirmware: async () => ({
              prepared,
              firmwareHandshake: { worktreeRoot: root },
              forgeProcess: {
                kind: "plugin_owned_stdio" as const,
                hostId: "host-test",
                command: ["forge"],
                start: async () => undefined,
              },
            }),
            resolveTier1Targets: async () => ({
              verdictIds: ["REQ-1"],
              cveId: "CVE-2026-0001",
              componentId: "component-1",
              findingId: null,
            }),
            createRunId: () => "bench-ambiguous-1",
          };
        },
      );
      registerActionTools(host.bb, ctx);

      const result = await host.harness.behavior.callAgentTool(
        "fs_bench_run",
        {
          pvId: "pv-1",
          tier: "tier1",
          requirement: "REQ-1",
          target: "CVE-2026-0001@component-1",
        },
        { projectId: "project-test", threadId: "thread-test" },
      );

      expect(decoded(result)).toMatchObject({
        ok: false,
        error: {
          code: "FORGE_DISPATCH_AMBIGUOUS",
          hint: expect.stringMatching(
            /bench-ambiguous-1.*automatic Forge reconciliation.*do not dispatch/iu,
          ),
          retryable: false,
          details: {
            runId: "bench-ambiguous-1",
            threadId: "bench-thread-ambiguous",
          },
        },
      });
      const row = ctx
        .db()
        .prepare(
          `SELECT status, job_id, finished_at, raw
         FROM verification_runs WHERE run_id='bench-ambiguous-1'`,
        )
        .get() as {
        status: string;
        job_id: string | null;
        finished_at: string | null;
        raw: string;
      };
      expect(verifyDynamic).toHaveBeenCalledTimes(1);
      expect(penTestRun).toHaveBeenCalledTimes(expectedPenCalls);
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      if (enqueueFailure) {
        expect(row).toMatchObject({
          status: "failed",
          job_id: expectedInitialJobId,
          finished_at: expect.any(String),
        });
        expect(JSON.parse(row.raw)).toMatchObject({
          dispatchAmbiguous: true,
          reconciliationState: "terminal",
          reconciliationError: "bench queue unavailable",
          failureCode: BENCH_DISPATCH_RECONCILIATION_FAILED_CODE,
          failureReason: expect.stringMatching(/do not dispatch a duplicate/iu),
        });
        expect(reconciliationTask).toBeUndefined();
        return;
      }
      expect(row).toMatchObject({
        status: "running",
        job_id: expectedInitialJobId,
        finished_at: null,
      });
      expect(JSON.parse(row.raw)).toMatchObject({
        dispatchAmbiguous: true,
        failureCode: "FORGE_DISPATCH_AMBIGUOUS",
        jobIds: expectedInitialJobId === null ? [] : [expectedInitialJobId],
      });
      if (!reconciliationTask) {
        throw new Error("Expected ambiguity reconciliation task");
      }
      await reconciliationTask.run(new AbortController().signal);
      const reconciled = ctx
        .db()
        .prepare(
          `SELECT status, job_id, finished_at, raw
           FROM verification_runs WHERE run_id='bench-ambiguous-1'`,
        )
        .get() as {
        status: string;
        job_id: string | null;
        finished_at: string | null;
        raw: string;
      };
      if (terminalFailure !== null) {
        const terminalRaw = JSON.parse(reconciled.raw) as Record<
          string,
          unknown
        >;
        expect(reconciled).toMatchObject({
          status: "failed",
          job_id: terminalFailure === "poll_limit" ? "dynamic-live-1" : null,
          finished_at: expect.any(String),
        });
        expect(terminalRaw).toMatchObject({
          dispatchAmbiguous: true,
          reconciliationState: "terminal",
          reconciliationPolicy:
            "baseline_diff_scope_match_without_evidence_promotion",
          failureCode: BENCH_DISPATCH_RECONCILIATION_FAILED_CODE,
        });
        expect(String(terminalRaw["failureReason"])).toMatch(
          /do not dispatch a duplicate/iu,
        );
        if (terminalFailure === "retry_exhausted") {
          expect(reconciliationListAttempts).toBe(3);
          expect(String(terminalRaw["failureReason"])).toMatch(
            /exhausted its retry budget/iu,
          );
          expect(reconciliationStatesSeenDuringSleep).toContain(
            "retry_required",
          );
        } else {
          expect(reconciliationListAttempts).toBe(1);
          expect(getJobStatus).toHaveBeenCalledTimes(900);
          expect(reconciliationStatesSeenDuringSleep).not.toContain(
            "retry_required",
          );
          expect(String(terminalRaw["reconciliationError"])).toMatch(
            /FORGE_JOB_POLL_LIMIT.*900 polls/iu,
          );
        }
        return;
      }
      expect(reconciled).toMatchObject({
        status: "failed",
        job_id: "dynamic-live-1",
        finished_at: expect.any(String),
      });
      expect(JSON.parse(reconciled.raw)).toMatchObject({
        dispatchAmbiguous: false,
        reconciliationState: "terminal",
        reconciliationAttempts: expectedReconciliationAttempts,
        reconciledJobIds: ["dynamic-live-1"],
        failureCode: BENCH_DISPATCH_RECONCILED_CODE,
      });
      if (reconciliationFailures > 0) {
        expect(reconciliationStatesSeenDuringSleep).toContain("retry_required");
      }
    },
  );
});
