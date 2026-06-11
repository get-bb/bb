// Route-level coverage for the plan §7 public workflow surfaces: launch
// (inline + named tiers, clientRequestId idempotency), list/detail/events
// reads, the wait-to-terminal long-poll, cancel/resume gates, id-prefix
// rejection, and the daemon-proxied per-agent event log.

import { createHash } from "node:crypto";
import {
  appendWorkflowRunEventsInTransaction,
  getWorkflowRunOperation,
  listWorkflowRuns,
} from "@bb/db";
import {
  workflowListResponseSchema,
  workflowRunEventsResponseSchema,
  workflowRunResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  appendRunStartedEvent,
  createRun,
  forceRunStatus,
  nextProducerEventId,
  requireRun,
  seedAnchorThread,
  seedWorkflowFixture,
  startRunToRunning,
  WORKFLOW_SOURCE,
  type WorkflowFixture,
} from "../helpers/workflow-runs.js";
import { requestWorkflowRunCancel } from "../../src/services/workflows/workflow-run-lifecycle.js";

const apiErrorSchema = z.object({ code: z.string(), message: z.string() });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWorkflowRun(
  harness: TestAppHarness,
  body: Record<string, unknown>,
): Promise<Response> {
  return harness.app.request("/api/v1/workflow-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function inlineLaunchBody(
  fixture: Pick<WorkflowFixture, "projectId">,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    projectId: fixture.projectId,
    source: { type: "inline", script: WORKFLOW_SOURCE },
    ...extra,
  };
}

describe("POST /workflow-runs", () => {
  it("launches an inline run with boundary-resolved defaults and replays clientRequestId", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-launch");

      const response = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, {
          args: { topic: "x" },
          clientRequestId: "launch-1",
        }),
      );
      expect(response.status).toBe(201);
      const raw = await readJson(response);
      const run = workflowRunResponseSchema.parse(raw);

      // Defaults filled once at the boundary; target resolved from the
      // project's default source; the source snapshot never leaves the server.
      expect(run.hostId).toBe(fixture.hostId);
      expect(run.workspacePath).toBe("/tmp/wf-route-launch");
      expect(run.sourceTier).toBe("inline");
      expect(run.workflowName).toBe("lifecycle-flow");
      expect(run.argsJson).toBe('{"topic":"x"}');
      expect(run.anchorThreadId).toBeNull();
      expect(run.providerId).toBe("codex");
      expect(run.sandbox).toBe("read-only");
      // Host session is live, so the launch already advanced to starting.
      expect(run.status).toBe("starting");
      expect(raw).not.toHaveProperty("scriptSource");

      // Replay: identical request, same run, nothing re-created.
      const replay = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, {
          args: { topic: "x" },
          clientRequestId: "launch-1",
        }),
      );
      expect(replay.status).toBe(201);
      expect(workflowRunResponseSchema.parse(await readJson(replay)).id).toBe(
        run.id,
      );
      expect(
        listWorkflowRuns(harness.db, {
          projectId: fixture.projectId,
        }),
      ).toHaveLength(1);

      // A replay whose payload diverges (same key, different args) is a buggy
      // client whose "new" launch would silently never run — conflict, never
      // a silent replay of the original.
      const divergent = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, {
          args: { topic: "different" },
          clientRequestId: "launch-1",
        }),
      );
      expect(divergent.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(divergent)).message).toContain(
        "different args",
      );

      // The same clientRequestId from another project is a conflict, not a
      // silent cross-project replay.
      const otherHost = seedHost(harness.deps, { id: "host-route-other" });
      const { project: otherProject } = seedProjectWithSource(harness.deps, {
        hostId: otherHost.id,
        path: "/tmp/wf-route-other",
      });
      const conflict = await postWorkflowRun(harness, {
        projectId: otherProject.id,
        source: { type: "inline", script: WORKFLOW_SOURCE },
        clientRequestId: "launch-1",
      });
      expect(conflict.status).toBe(409);
    });
  });

  it("persists the anchor thread on anchored launches", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-anchored");
      const { thread } = seedAnchorThread(harness, fixture);

      const response = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, { anchorThreadId: thread.id }),
      );
      expect(response.status).toBe(201);
      const run = workflowRunResponseSchema.parse(await readJson(response));
      // End to end, not accepted-and-dropped: the response projection and the
      // persisted row both carry the anchor (M5's fold reads the row).
      expect(run.anchorThreadId).toBe(thread.id);
      expect(requireRun(harness, run.id).anchorThreadId).toBe(thread.id);
    });
  });

  it("inherits the anchor thread environment's host and workspace when hostId is omitted", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-anchor-inherit");
      const { environment, thread } = seedAnchorThread(harness, fixture);

      // Anchored + no hostId: the launch target is the anchor thread's
      // environment, not the project's default source.
      const inherited = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, { anchorThreadId: thread.id }),
      );
      expect(inherited.status).toBe(201);
      const run = workflowRunResponseSchema.parse(await readJson(inherited));
      expect(run.hostId).toBe(environment.hostId);
      expect(run.workspacePath).toBe(environment.path);
      expect(run.workspacePath).not.toBe("/tmp/wf-route-anchor-inherit");

      // Explicit hostId still wins: project-source resolution, not the env.
      const explicit = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, {
          anchorThreadId: thread.id,
          hostId: fixture.hostId,
        }),
      );
      expect(explicit.status).toBe(201);
      expect(
        workflowRunResponseSchema.parse(await readJson(explicit))
          .workspacePath,
      ).toBe("/tmp/wf-route-anchor-inherit");

      // Unanchored launches keep the default-source resolution.
      const unanchored = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture),
      );
      expect(unanchored.status).toBe(201);
      expect(
        workflowRunResponseSchema.parse(await readJson(unanchored))
          .workspacePath,
      ).toBe("/tmp/wf-route-anchor-inherit");

      // Inheritance follows the environment's host even when it differs
      // from the default source's host — no project source is consulted.
      const remoteHost = seedHost(harness.deps, { id: "host-anchor-remote" });
      const remoteEnvironment = seedEnvironment(harness.deps, {
        hostId: remoteHost.id,
        projectId: fixture.projectId,
        path: "/tmp/remote-checkout",
      });
      const remoteThread = seedThread(harness.deps, {
        projectId: fixture.projectId,
        environmentId: remoteEnvironment.id,
      });
      const remote = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, { anchorThreadId: remoteThread.id }),
      );
      expect(remote.status).toBe(201);
      const remoteRun = workflowRunResponseSchema.parse(await readJson(remote));
      expect(remoteRun.hostId).toBe(remoteHost.id);
      expect(remoteRun.workspacePath).toBe("/tmp/remote-checkout");
    });
  });

  it("fails anchored launches explicitly when the anchor environment is unusable", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-anchor-env-gates");

      // Never-attached anchor thread: explicit 409, never a silent fallback
      // to the project source (that would be implicit host selection).
      const detachedThread = seedThread(harness.deps, {
        projectId: fixture.projectId,
      });
      const neverAttached = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, { anchorThreadId: detachedThread.id }),
      );
      expect(neverAttached.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(neverAttached)).code).toBe(
        "thread_environment_unavailable",
      );

      // Not-ready anchor environment: the standard readiness 409.
      const provisioningEnvironment = seedEnvironment(harness.deps, {
        hostId: fixture.hostId,
        projectId: fixture.projectId,
        status: "provisioning",
      });
      const provisioningThread = seedThread(harness.deps, {
        projectId: fixture.projectId,
        environmentId: provisioningEnvironment.id,
      });
      const notReady = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, { anchorThreadId: provisioningThread.id }),
      );
      expect(notReady.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(notReady)).code).toBe(
        "environment_not_ready",
      );

      // An explicit hostId sidesteps the unusable environment entirely.
      const explicit = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, {
          anchorThreadId: detachedThread.id,
          hostId: fixture.hostId,
        }),
      );
      expect(explicit.status).toBe(201);
    });
  });

  it("re-requests the start when a replay finds the run still created (crash self-heal)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-replay-created");
      // The crash shape: the launch created the row (idempotency key
      // persisted) but died before requestWorkflowRunStart — no start
      // operation exists.
      const stranded = createRun(harness, fixture, {
        clientRequestId: "crashed-launch",
      });
      expect(stranded.status).toBe("created");
      expect(
        getWorkflowRunOperation(harness.db, {
          runId: stranded.id,
          kind: "start",
        }),
      ).toBeNull();

      const replay = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, { clientRequestId: "crashed-launch" }),
      );
      expect(replay.status).toBe(201);
      expect(workflowRunResponseSchema.parse(await readJson(replay)).id).toBe(
        stranded.id,
      );
      // The replay healed the stranded run: a start operation now exists and
      // (host session live) is already queued.
      expect(
        getWorkflowRunOperation(harness.db, {
          runId: stranded.id,
          kind: "start",
        })?.state,
      ).toBe("queued");
      expect(requireRun(harness, stranded.id).status).toBe("starting");
    });
  });

  it("rejects invalid launches: bad script, unknown project, cross-project anchor, host without source", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-launch-gates");

      const invalidScript = await postWorkflowRun(harness, {
        projectId: fixture.projectId,
        source: {
          type: "inline",
          script: 'export const meta = { name: (() => "x")() };',
        },
      });
      expect(invalidScript.status).toBe(422);
      expect(apiErrorSchema.parse(await readJson(invalidScript)).code).toBe(
        "workflow_validation_failed",
      );

      const unknownProject = await postWorkflowRun(harness, {
        projectId: "proj_missing",
        source: { type: "inline", script: WORKFLOW_SOURCE },
      });
      expect(unknownProject.status).toBe(404);

      const foreignHost = seedHost(harness.deps, { id: "host-route-foreign" });
      const { project: foreignProject } = seedProjectWithSource(harness.deps, {
        hostId: foreignHost.id,
        path: "/tmp/wf-route-foreign",
      });
      const { thread: foreignThread } = seedAnchorThread(harness, {
        hostId: foreignHost.id,
        projectId: foreignProject.id,
      });
      const crossProjectAnchor = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, { anchorThreadId: foreignThread.id }),
      );
      expect(crossProjectAnchor.status).toBe(400);

      const hostWithoutSource = await postWorkflowRun(
        harness,
        inlineLaunchBody(fixture, { hostId: foreignHost.id }),
      );
      expect(hostWithoutSource.status).toBe(404);
    });
  });

  it("resolves named launches through the registry and records the listing tier", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-named");
      const listing = {
        name: "lifecycle-flow",
        description: "Lifecycle test fixture",
        tier: "project" as const,
      };

      const responsePromise = postWorkflowRun(harness, {
        projectId: fixture.projectId,
        source: { type: "named", name: "lifecycle-flow" },
      });
      const listRpc = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "workflow.list",
      );
      expect(listRpc.command).toMatchObject({
        rootPath: "/tmp/wf-route-named",
      });
      await reportQueuedCommandSuccess(harness, listRpc, {
        workflows: [listing],
      });
      const resolveRpc = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "workflow.resolve",
      );
      expect(resolveRpc.command).toMatchObject({
        name: "lifecycle-flow",
        rootPath: "/tmp/wf-route-named",
      });
      await reportQueuedCommandSuccess(harness, resolveRpc, {
        name: "lifecycle-flow",
        content: WORKFLOW_SOURCE,
        sha256: "daemon-reported-hash-never-trusted",
      });

      const response = await responsePromise;
      expect(response.status).toBe(201);
      const run = workflowRunResponseSchema.parse(await readJson(response));
      expect(run.sourceTier).toBe("project");
      expect(run.workflowName).toBe("lifecycle-flow");
      // The snapshot hash is computed server-side over the raw source.
      expect(run.scriptHash).toBe(
        createHash("sha256").update(WORKFLOW_SOURCE, "utf8").digest("hex"),
      );

      // Unknown names 404 before any source fetch.
      const missingPromise = postWorkflowRun(harness, {
        projectId: fixture.projectId,
        source: { type: "named", name: "missing-flow" },
      });
      const secondListRpc = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "workflow.list" &&
          queued.row.id !== listRpc.row.id,
      );
      await reportQueuedCommandSuccess(harness, secondListRpc, {
        workflows: [listing],
      });
      const missingResponse = await missingPromise;
      expect(missingResponse.status).toBe(404);
      expect(apiErrorSchema.parse(await readJson(missingResponse)).code).toBe(
        "workflow_not_found",
      );
    });
  });
});

describe("GET /workflows", () => {
  it("lists definitions from the resolved source root across tiers", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-list-defs");
      const listings = [
        {
          name: "lifecycle-flow",
          description: "Lifecycle test fixture",
          tier: "project" as const,
        },
        {
          name: "deep-research",
          description: "Builtin",
          whenToUse: "Research tasks",
          tier: "builtin" as const,
        },
      ];

      const responsePromise = harness.app.request(
        `/api/v1/workflows?projectId=${fixture.projectId}`,
      );
      const listRpc = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "workflow.list",
      );
      expect(listRpc.command).toMatchObject({
        rootPath: "/tmp/wf-route-list-defs",
      });
      await reportQueuedCommandSuccess(harness, listRpc, {
        workflows: listings,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(
        workflowListResponseSchema.parse(await readJson(response)),
      ).toEqual(listings);

      // Explicit host with no local-path source → 404 (plan semantics).
      seedHost(harness.deps, { id: "host-route-no-source" });
      const noSource = await harness.app.request(
        `/api/v1/workflows?projectId=${fixture.projectId}&hostId=host-route-no-source`,
      );
      expect(noSource.status).toBe(404);
    });
  });
});

describe("GET /workflow-runs reads", () => {
  it("lists project runs and serves the detail projection", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-reads");
      const first = createRun(harness, fixture);
      const second = createRun(harness, fixture);

      const listResponse = await harness.app.request(
        `/api/v1/workflow-runs?projectId=${fixture.projectId}`,
      );
      expect(listResponse.status).toBe(200);
      const runs = z
        .array(workflowRunResponseSchema)
        .parse(await readJson(listResponse));
      expect(runs.map((run) => run.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );

      const limited = await harness.app.request(
        `/api/v1/workflow-runs?projectId=${fixture.projectId}&limit=1`,
      );
      expect(
        z.array(workflowRunResponseSchema).parse(await readJson(limited)),
      ).toHaveLength(1);

      const detail = await harness.app.request(
        `/api/v1/workflow-runs/${first.id}`,
      );
      expect(detail.status).toBe(200);
      expect(workflowRunResponseSchema.parse(await readJson(detail)).id).toBe(
        first.id,
      );

      const missing = await harness.app.request(
        "/api/v1/workflow-runs/wfr_missing",
      );
      expect(missing.status).toBe(404);
    });
  });

  it("returns parsed run events with the afterSeq cursor", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-events");
      const run = createRun(harness, fixture);
      appendRunStartedEvent(harness, run.id);
      harness.db.transaction(
        (tx) => {
          appendWorkflowRunEventsInTransaction(tx, [
            {
              runId: run.id,
              type: "log",
              agentIndex: null,
              payload: JSON.stringify({ type: "log", message: "hello" }),
              producerEventId: nextProducerEventId(),
              producerEventPayloadHash: "route-events-log",
            },
            // The tolerant-reader stance: one unreadable row is skipped with
            // a warning, never a 500 for the whole stream.
            {
              runId: run.id,
              type: "log",
              agentIndex: null,
              payload: "not-json",
              producerEventId: nextProducerEventId(),
              producerEventPayloadHash: "route-events-garbage",
            },
          ]);
        },
        { behavior: "immediate" },
      );

      const response = await harness.app.request(
        `/api/v1/workflow-runs/${run.id}/events`,
      );
      expect(response.status).toBe(200);
      const rows = workflowRunEventsResponseSchema.parse(
        await readJson(response),
      );
      // Three rows persisted; the unreadable one (sequence 3) is skipped.
      expect(rows.map((row) => row.sequence)).toEqual([1, 2]);
      expect(rows[0]?.event.type).toBe("run/started");
      expect(rows[1]?.event).toEqual({ type: "log", message: "hello" });

      const afterFirst = await harness.app.request(
        `/api/v1/workflow-runs/${run.id}/events?afterSeq=1`,
      );
      const tail = workflowRunEventsResponseSchema.parse(
        await readJson(afterFirst),
      );
      expect(tail.map((row) => row.sequence)).toEqual([2]);
    });
  });

  it("long-polls /wait to terminal and 204s on timeout", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-wait");

      const timedOut = createRun(harness, fixture);
      const timeoutResponse = await harness.app.request(
        `/api/v1/workflow-runs/${timedOut.id}/wait?waitMs=1`,
      );
      expect(timeoutResponse.status).toBe(204);

      const run = createRun(harness, fixture);
      const waitPromise = harness.app.request(
        `/api/v1/workflow-runs/${run.id}/wait?waitMs=4000`,
      );
      await sleep(100);
      // Server-side cancel settles the run and notifies the hub waiter.
      await requestWorkflowRunCancel(harness.deps, { runId: run.id });
      const waitResponse = await waitPromise;
      expect(waitResponse.status).toBe(200);
      const settled = workflowRunResponseSchema.parse(
        await readJson(waitResponse),
      );
      expect(settled.status).toBe("cancelled");
    });
  });
});

describe("workflow run archive and delete", () => {
  it("archives settled runs out of lists while keeping them readable by id", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-archive");
      const archived = createRun(harness, fixture);
      const visible = createRun(harness, fixture);
      forceRunStatus(harness, archived.id, "starting");
      forceRunStatus(harness, archived.id, "running");
      forceRunStatus(harness, archived.id, "interrupted");

      const response = await harness.app.request(
        `/api/v1/workflow-runs/${archived.id}/archive`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);

      const listResponse = await harness.app.request(
        `/api/v1/workflow-runs?projectId=${fixture.projectId}`,
      );
      const runs = z
        .array(workflowRunResponseSchema)
        .parse(await readJson(listResponse));
      expect(runs.map((run) => run.id)).toEqual([visible.id]);

      // Archived runs stay reachable by id (old deep links keep working).
      const detail = await harness.app.request(
        `/api/v1/workflow-runs/${archived.id}`,
      );
      expect(detail.status).toBe(200);
    });
  });

  it("soft-deletes settled runs: gone from lists and 404 by id", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-delete");
      const deleted = createRun(harness, fixture);
      forceRunStatus(harness, deleted.id, "starting");
      forceRunStatus(harness, deleted.id, "running");
      forceRunStatus(harness, deleted.id, "interrupted");

      const response = await harness.app.request(
        `/api/v1/workflow-runs/${deleted.id}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(200);

      const listResponse = await harness.app.request(
        `/api/v1/workflow-runs?projectId=${fixture.projectId}`,
      );
      expect(
        z.array(workflowRunResponseSchema).parse(await readJson(listResponse)),
      ).toEqual([]);
      const detail = await harness.app.request(
        `/api/v1/workflow-runs/${deleted.id}`,
      );
      expect(detail.status).toBe(404);

      // The row survives for the retention/run-dir sweeps.
      expect(requireRun(harness, deleted.id).deletedAt).not.toBeNull();
    });
  });

  it("409s archive and delete for runs that are still active", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-archive-active");
      const run = createRun(harness, fixture);
      forceRunStatus(harness, run.id, "starting");
      forceRunStatus(harness, run.id, "running");

      for (const request of [
        harness.app.request(`/api/v1/workflow-runs/${run.id}/archive`, {
          method: "POST",
        }),
        harness.app.request(`/api/v1/workflow-runs/${run.id}`, {
          method: "DELETE",
        }),
      ]) {
        const response = await request;
        expect(response.status).toBe(409);
        expect(apiErrorSchema.parse(await readJson(response)).code).toBe(
          "workflow_run_not_settled",
        );
      }
    });
  });

  it("lists runs across all projects when projectId is omitted", async () => {
    await withTestHarness(async (harness) => {
      const fixtureA = seedWorkflowFixture(harness, "route-global-a");
      const fixtureB = seedWorkflowFixture(harness, "route-global-b");
      const runA = createRun(harness, fixtureA);
      const runB = createRun(harness, fixtureB);

      const listResponse = await harness.app.request("/api/v1/workflow-runs");
      const runs = z
        .array(workflowRunResponseSchema)
        .parse(await readJson(listResponse));
      expect(runs.map((run) => run.id).sort()).toEqual(
        [runA.id, runB.id].sort(),
      );
    });
  });
});

describe("POST /workflow-runs/:id/cancel and /resume", () => {
  it("routes requests through the lifecycle gates", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-lifecycle");

      const running = createRun(harness, fixture);
      await startRunToRunning(harness, running.id);

      const resumeRunning = await harness.app.request(
        `/api/v1/workflow-runs/${running.id}/resume`,
        { method: "POST" },
      );
      expect(resumeRunning.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(resumeRunning)).code).toBe(
        "workflow_run_not_resumable",
      );

      const cancelRunning = await harness.app.request(
        `/api/v1/workflow-runs/${running.id}/cancel`,
        { method: "POST" },
      );
      expect(cancelRunning.status).toBe(200);
      await expect(readJson(cancelRunning)).resolves.toEqual({ ok: true });
      // Running runs converge via the durable command, not a server settle.
      expect(requireRun(harness, running.id).status).toBe("running");
      expect(
        getWorkflowRunOperation(harness.db, {
          runId: running.id,
          kind: "cancel",
        })?.state,
      ).toBe("queued");

      const interrupted = createRun(harness, fixture);
      await startRunToRunning(harness, interrupted.id);
      forceRunStatus(harness, interrupted.id, "interrupted", "test");
      const resumeInterrupted = await harness.app.request(
        `/api/v1/workflow-runs/${interrupted.id}/resume`,
        { method: "POST" },
      );
      expect(resumeInterrupted.status).toBe(200);
      expect(
        getWorkflowRunOperation(harness.db, {
          runId: interrupted.id,
          kind: "resume",
        })?.state,
      ).toBe("queued");

      // The recorded M4 decision: a fresh cancel of a converged-interrupted
      // run settles server-side instead of 409ing.
      const cancelInterrupted = await harness.app.request(
        `/api/v1/workflow-runs/${interrupted.id}/cancel`,
        { method: "POST" },
      );
      expect(cancelInterrupted.status).toBe(200);
      expect(requireRun(harness, interrupted.id).status).toBe("cancelled");
    });
  });
});

describe("id prefix validation", () => {
  it("rejects thread ids on run routes and workflow ids on thread routes", async () => {
    await withTestHarness(async (harness) => {
      const runWithThreadId = await harness.app.request(
        "/api/v1/workflow-runs/thr_abc123",
      );
      expect(runWithThreadId.status).toBe(400);

      const cancelWithThreadId = await harness.app.request(
        "/api/v1/workflow-runs/thr_abc123/cancel",
        { method: "POST" },
      );
      expect(cancelWithThreadId.status).toBe(400);

      for (const workflowId of ["wfr_abc123", "wfa_abc123_0"]) {
        const threadWithWorkflowId = await harness.app.request(
          `/api/v1/threads/${workflowId}`,
        );
        expect(threadWithWorkflowId.status).toBe(400);
        expect(
          apiErrorSchema.parse(await readJson(threadWithWorkflowId)).code,
        ).toBe("invalid_request");
      }
    });
  });
});

describe("GET /workflow-runs/:id/agents/:index/events", () => {
  it("proxies the per-agent event log from the run dir and parses its lines", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-agent-log");
      const run = createRun(harness, fixture);

      // Agent display indexes are 1-based and journal-stable: the first
      // agent's log is `agents/1.events.jsonl` and its synthetic thread id is
      // `wfa_<runId>_1` — the production shape this route proxies.
      const logLines = [
        JSON.stringify({
          id: "evt_wf_1",
          scope: { kind: "thread" },
          threadId: `wfa_${run.id}_1`,
          seq: 1,
          createdAt: 1000,
          type: "thread/started",
          data: {},
        }),
        '{"torn":', // mid-write tail line: skipped, never a 500
      ].join("\n");

      const responsePromise = harness.app.request(
        `/api/v1/workflow-runs/${run.id}/agents/1/events`,
      );
      const readRpc = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "host.read_file_relative",
      );
      expect(readRpc.command).toMatchObject({
        rootPath: `/tmp/bb-host-data/${fixture.hostId}/workflow-runs/${run.id}`,
        path: "agents/1.events.jsonl",
      });
      await reportQueuedCommandSuccess(harness, readRpc, {
        path: "agents/1.events.jsonl",
        content: logLines,
        contentEncoding: "utf8",
        sizeBytes: logLines.length,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      const events = z
        .array(
          z.object({
            id: z.string(),
            seq: z.number(),
            type: z.string(),
          }),
        )
        .parse(await readJson(response));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread/started");
    });
  });

  it("404s when the log is missing and 400s a non-numeric index", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-agent-log-miss");
      const run = createRun(harness, fixture);

      const badIndex = await harness.app.request(
        `/api/v1/workflow-runs/${run.id}/agents/zero/events`,
      );
      expect(badIndex.status).toBe(400);

      const responsePromise = harness.app.request(
        `/api/v1/workflow-runs/${run.id}/agents/7/events`,
      );
      const readRpc = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "host.read_file_relative",
      );
      await reportQueuedCommandError(harness, readRpc, {
        errorCode: "ENOENT",
        errorMessage: "No such file",
      });
      const response = await responsePromise;
      expect(response.status).toBe(404);
    });
  });
});
