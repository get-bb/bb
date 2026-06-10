// M4 exit criteria over the public routes: launch target resolution (explicit
// hostId targets the project source on that host; a project with no default
// source yields the 409), the id-prefix defense (wfa_*/wfr_* ids rejected
// where thr_* ids are expected and vice versa), and the per-agent event-log
// proxy's two daemon postures — decodable rows for a settled run while the
// host is online, `host_unavailable` once it is down.

import { describe, expect, it } from "vitest";
import { waitForHostDisconnected } from "../../helpers/assertions.js";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  expectApiError,
  getPublicWorkflowAgentEvents,
  launchPublicWorkflowRun,
  listPublicWorkflowRunEvents,
  listPublicWorkflows,
  waitForPublicWorkflowRunTerminal,
} from "../../helpers/workflow-public-api.js";
import {
  clearDefaultProjectSourceFlag,
  INTEGRATION_WORKFLOW_SOURCE,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
} from "../../helpers/workflow-runs.js";

const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(30_000);

describe.sequential("workflow public resolution and id guards", () => {
  it(
    "resolves explicit hosts, 409s a default-less project, rejects mismatched id prefixes, and degrades agent-event reads offline",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Resolution Guards",
        });

        // Explicit hostId targets that host's project source; the run row
        // records both the host and the resolved cwd.
        const run = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          hostId: harness.hostId,
          source: { type: "inline", script: INTEGRATION_WORKFLOW_SOURCE },
        });
        expect(run.hostId).toBe(harness.hostId);
        expect(run.workspacePath).toBe(harness.repoDir);
        const settled = await waitForPublicWorkflowRunTerminal(
          harness.api,
          run.id,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.status).toBe("completed");

        // A settled run's per-agent log proxies through the live daemon and
        // decodes as run-scoped thread event rows. The agent's display index
        // comes from the run events (1-based), as a timeline consumer would
        // address it.
        const settledRows = await listPublicWorkflowRunEvents(
          harness.api,
          run.id,
        );
        const agentIndex = settledRows.find(
          (row) => row.event.type === "agent/completed",
        )?.agentIndex;
        if (agentIndex === null || agentIndex === undefined) {
          throw new Error("Expected an agent/completed event with an index");
        }
        const agentEvents = await getPublicWorkflowAgentEvents(
          harness.api,
          run.id,
          agentIndex,
        );
        expect(agentEvents.length).toBeGreaterThan(0);
        expect(
          agentEvents.every((row) =>
            row.threadId.startsWith(`wfa_${run.id}_${agentIndex}`),
          ),
        ).toBe(true);

        // No default source (db lever — the public surface cannot produce
        // this state): implicit-host launches and listings 409, while
        // explicit-host resolution keeps working.
        clearDefaultProjectSourceFlag(harness.db, project.id);
        const launchNoDefault = await harness.api["workflow-runs"].$post({
          json: {
            projectId: project.id,
            source: { type: "inline", script: INTEGRATION_WORKFLOW_SOURCE },
          },
        });
        const launchError = await expectApiError(launchNoDefault, 409);
        expect(launchError.code).toBe("invalid_request");
        expect(launchError.message).toContain("no default source");
        const listNoDefault = await harness.api.workflows.$get({
          query: { projectId: project.id },
        });
        expect((await expectApiError(listNoDefault, 409)).code).toBe(
          "invalid_request",
        );
        expect(
          (
            await listPublicWorkflows(harness.api, {
              projectId: project.id,
              hostId: harness.hostId,
            })
          ).some((listing) => listing.tier === "builtin"),
        ).toBe(true);

        // Id-prefix defense: workflow ids are rejected outright on thr_*
        // routes (400, not an incidental 404), and thread ids on wfr_* routes.
        for (const workflowId of ["wfr_abc123", `wfa_${run.id}_0`]) {
          const threadResponse = await harness.api.threads[":id"].$get({
            param: { id: workflowId },
          });
          expect((await expectApiError(threadResponse, 400)).code).toBe(
            "invalid_request",
          );
        }
        const runWithThreadId = await harness.api["workflow-runs"][
          ":id"
        ].$get({ param: { id: "thr_abc123" } });
        expect((await expectApiError(runWithThreadId, 400)).code).toBe(
          "invalid_request",
        );
        const resumeWithThreadId = await harness.api["workflow-runs"][
          ":id"
        ].resume.$post({ param: { id: "thr_abc123" } });
        await expectApiError(resumeWithThreadId, 400);

        // Host offline: daemon-proxied reads fail with host_unavailable —
        // the durable run row/events remain readable, the host-local log
        // does not.
        await harness.shutdownDaemon("workflow-public-offline");
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          RECOVERY_TIMEOUT_MS,
        );
        const offlineAgentEvents = await harness.api["workflow-runs"][
          ":id"
        ].agents[":index"].events.$get({
          param: { id: run.id, index: String(agentIndex) },
        });
        expect((await expectApiError(offlineAgentEvents, 502)).code).toBe(
          "host_unavailable",
        );
        const offlineListings = await harness.api.workflows.$get({
          query: { projectId: project.id, hostId: harness.hostId },
        });
        expect((await expectApiError(offlineListings, 502)).code).toBe(
          "host_unavailable",
        );
      }),
  );
});
