// Durable start intent across daemon connectivity loss — the live-command
// port of the old command-row redelivery/expiry coverage (M3 exit criterion
// (d)). There is no command table or delivery lease anymore: a workflow.start
// is a live WS RPC whose failure settles in-process. The recovery contract
// (apps/server/src/services/workflows/workflow-run-lifecycle.ts):
//
// - `host_unavailable` with zero run events since the operation queued →
//   delivery never confirmed; the operation RESETS to `requested` (payload
//   intact) instead of failing the run, and the lifecycle sweep re-dispatches
//   once the host session is usable again.
// - any failure with run events since queue → the run demonstrably started
//   and the operation completes. That half needs a socket that drops AFTER
//   the daemon spawned the runner but BEFORE its ack lands — only the unit
//   harness's capture socket can stage that deterministically, so it stays
//   unit-covered in apps/server/test/workflows/workflow-run-lifecycle.test.ts
//   and is not re-asserted here.
//
// This test drives the first bucket end to end over the real stack. The
// server closes the session row the moment it sees the WS close, so a plain
// socket drop would hold at the advance path's no-session gate without ever
// dispatching; reviving the session row (the network-partition shape — the
// socket is gone but the server has not noticed) makes the live RPC really
// fire into the missing socket and fail `host_unavailable`. The durable
// intent then survives repeated offline sweeps without failing the run, and
// the reconnect-time sweep re-dispatches the preserved payload to completion
// with exactly one runner spawn.

import { getActiveSession } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  waitForHostConnected,
  waitForHostDisconnected,
} from "../../helpers/assertions.js";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  countWorkflowRunEventsOfType,
  createIntegrationWorkflowRun,
  listWorkflowRunEventRows,
  requestWorkflowRunStart,
  requireWorkflowRun,
  requireWorkflowRunOperation,
  reviveClosedHostSession,
  runWorkflowRunLifecycleSweep,
  waitForWorkflowRunOperation,
  waitForWorkflowRunStatus,
  WORKFLOW_OPERATION_TIMEOUT_MS,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../../helpers/workflow-runs.js";

const HOST_OFFLINE_TIMEOUT_MS = scaleTimeoutMs(15_000);
const HOST_RECONNECT_TIMEOUT_MS = scaleTimeoutMs(30_000);

describe.sequential("workflow start dispatch recovery integration", () => {
  it(
    "resets a start lost to a dropped daemon socket and re-dispatches it on reconnect (exit criterion d, live-command port)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Start Dispatch Recovery",
        });
        const run = createIntegrationWorkflowRun(harness, {
          projectId: project.id,
        });
        const deps = workflowServerDeps(harness);

        // Drop the daemon's WS, then revive the session row the close handler
        // just closed: the advance path passes the active-session gate and
        // really dispatches into the missing socket.
        await harness.daemonApp.connection.shutdown();
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          HOST_OFFLINE_TIMEOUT_MS,
        );
        reviveClosedHostSession(harness.db, harness.hostId);
        expect(getActiveSession(harness.db, harness.hostId)).not.toBeNull();

        await requestWorkflowRunStart(deps, { runId: run.id });
        // The dispatch transitioned the run created→starting, then the live
        // RPC failed `host_unavailable` with zero run events since queue: the
        // settle resets the operation to `requested` with the execution id
        // cleared and the prebuilt command payload preserved.
        await waitForWorkflowRunOperation(
          harness,
          run.id,
          "start",
          (operation) =>
            operation.state === "requested" && operation.commandId === null,
          WORKFLOW_OPERATION_TIMEOUT_MS,
        );
        expect(requireWorkflowRun(harness, run.id).status).toBe("starting");
        expect(listWorkflowRunEventRows(harness, run.id)).toHaveLength(0);

        // A sweep while the socket is still down re-dispatches and re-resets:
        // the durable intent survives repeated attempts and the run is never
        // failed.
        await runWorkflowRunLifecycleSweep(deps);
        await waitForWorkflowRunOperation(
          harness,
          run.id,
          "start",
          (operation) =>
            operation.state === "requested" && operation.commandId === null,
          WORKFLOW_OPERATION_TIMEOUT_MS,
        );
        const heldRun = requireWorkflowRun(harness, run.id);
        expect(heldRun.status).toBe("starting");
        expect(heldRun.settledAt).toBeNull();
        expect(listWorkflowRunEventRows(harness, run.id)).toHaveLength(0);

        // The same daemon instance reconnects; the sweep re-dispatches the
        // preserved payload and the run executes to completion for real.
        await harness.daemonApp.connection.start();
        await waitForHostConnected(harness.api, HOST_RECONNECT_TIMEOUT_MS);
        await runWorkflowRunLifecycleSweep(deps);
        const settled = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.resultJson).toContain(
          "Response to: do the integration work",
        );
        expect(settled.failureReason).toBeNull();
        expect(
          requireWorkflowRunOperation(harness, run.id, "start").state,
        ).toBe("completed");
        // Exactly one runner spawn across every dispatch attempt.
        expect(
          countWorkflowRunEventsOfType(harness, run.id, "run/started"),
        ).toBe(1);
        expect(
          countWorkflowRunEventsOfType(harness, run.id, "run/completed"),
        ).toBe(1);
      }),
  );
});
