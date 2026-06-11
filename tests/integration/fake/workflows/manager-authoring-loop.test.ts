// M6 exit criterion (plan §10): a manager authors, validates, launches, and
// consumes a workflow UNASSISTED — and is woken by the settlement message —
// over the real server + daemon + runner stack with fake providers. The fake
// provider is an echo script with no shell, so the test performs the
// manager's actions exactly as its thread shell would, crossing only real
// production surfaces at every step:
//
// 1. AUTHOR  — write the .workflow.js into the MANAGER'S OWN workspace
//    checkout, under `.bb/workflows/` (the project registry tier the
//    bb-workflows skill teaches agents to author into).
// 2. VALIDATE — the real `bb workflow validate` CLI handler in-process (the
//    production commander registration; the exact gate the server applies at
//    launch), plus the live registry route showing the workflow at tier
//    `project`.
// 3. LAUNCH  — the anchored named launch the CLI sends with BB_THREAD_ID set:
//    POST /workflow-runs with `source: named`, `anchorThreadId` = the manager,
//    and hostId OMITTED (inherited from the manager's environment).
// 4. WAKE    — the run completes for real and the manager is woken by the
//    settlement system message carrying the run id: the persisted
//    system-initiated turn request, and the manager's own turn consuming it
//    (the fake provider's echo of the message), both asserted.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { createPublicApiClient } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { registerWorkflowValidateCommand } from "../../../../apps/cli/src/commands/workflow/validate.js";
import { waitForThreadStatus } from "../../helpers/assertions.js";
import { getThreadEvents } from "../../helpers/api.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import {
  hasPrefixedWorkflowMessagePart,
  listManagerWorkflowMessageRows,
  managerWorkflowMessageText,
  WORKFLOW_RUN_COMPLETED_MESSAGE_MARKER,
} from "../../helpers/manager-workflow-messages.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import { runWorkflowCli } from "../../helpers/workflow-cli.js";
import {
  launchPublicWorkflowRun,
  listPublicWorkflows,
  waitForPublicWorkflowRunTerminal,
} from "../../helpers/workflow-public-api.js";
import { WORKFLOW_RUN_SETTLE_TIMEOUT_MS } from "../../helpers/workflow-runs.js";

const MANAGER_READY_TIMEOUT_MS = scaleTimeoutMs(30_000);
const NOTIFICATION_TIMEOUT_MS = scaleTimeoutMs(20_000);
/** Settle window proving no duplicate settlement message fires after the first. */
const DUPLICATE_SETTLE_WINDOW_MS = 1_500;

const AUTHORED_WORKFLOW_NAME = "manager-authored-flow";
const AUTHORED_AGENT_PROMPT = "compile the findings";

/** What the manager would write: plain JS, exported pure-literal meta, one agent turn. */
const AUTHORED_WORKFLOW_SOURCE = `export const meta = {
  name: ${JSON.stringify(AUTHORED_WORKFLOW_NAME)},
  description: "Manager-authored M6 authoring-loop fixture",
};

const result = await agent(${JSON.stringify(AUTHORED_AGENT_PROMPT)});
return { result };
`;

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

/**
 * The woken-manager proof: the settlement message queued a manager turn, the
 * manager's provider ran it, and its agent response (the fake provider's
 * `Response to: …` echo) mentioning the run id persisted on the thread.
 */
async function waitForManagerAgentEcho(
  api: PublicApiClient,
  threadId: string,
  runId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await getThreadEvents(api, threadId);
    const echoed = rows.some(
      (row) =>
        row.type === "item/completed" &&
        row.data.item.type === "agentMessage" &&
        row.data.item.text.includes(runId),
    );
    if (echoed) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for a manager agent message mentioning run ${runId} ` +
          `on thread ${threadId}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

describe.sequential("workflow manager authoring loop integration", () => {
  it(
    "manager authors, validates, launches, and is woken by the settlement message (M6 exit criterion)",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Manager Authoring Loop",
        });
        // The manager is an ordinary thread anchored at the project checkout
        // (an unmanaged env at the project source path), on a real catalog
        // provider id (executed by the harness's fake adapter): manager
        // system messages dispatch as `turn.submit`, whose gate rejects
        // non-catalog providers.
        const { environment, thread: manager } = await createReadyHostThread(
          harness,
          {
            projectId: project.id,
            providerId: "codex",
            timeoutMs: MANAGER_READY_TIMEOUT_MS,
            title: "Authoring manager",
            workspace: { type: "unmanaged", path: harness.repoDir },
          },
        );
        const workspacePath = environment.path;
        if (!workspacePath) {
          throw new Error("Manager environment has no workspace path");
        }
        // The manager's workspace IS the project checkout — authoring lands
        // in the repo, versioned.
        expect(workspacePath).toBe(harness.repoDir);

        // AUTHOR: the manager writes the workflow into its own workspace's
        // project registry tier.
        const workflowsDir = join(workspacePath, ".bb", "workflows");
        await mkdir(workflowsDir, { recursive: true });
        const workflowFile = join(
          workflowsDir,
          `${AUTHORED_WORKFLOW_NAME}.workflow.js`,
        );
        await writeFile(workflowFile, AUTHORED_WORKFLOW_SOURCE, "utf8");

        // VALIDATE: the real `bb workflow validate` handler — pure-literal
        // meta parse + determinism lint, the exact server launch gate.
        const validation = await runWorkflowCli({
          argv: ["workflow", "validate", workflowFile],
          register: registerWorkflowValidateCommand,
        });
        expect(validation.stdout.join("\n")).toContain("is a valid workflow");
        expect(validation.stdout.join("\n")).toContain(
          `Name: ${AUTHORED_WORKFLOW_NAME}`,
        );

        // The live registry (project-source resolution + daemon
        // `workflow.list`) resolves the authored file at tier `project`,
        // merged above the shipped builtins.
        const listings = await listPublicWorkflows(harness.api, {
          projectId: project.id,
        });
        const authored = listings.find(
          (workflow) => workflow.name === AUTHORED_WORKFLOW_NAME,
        );
        expect(authored?.tier).toBe("project");

        // LAUNCH: the anchored named launch `bb workflow run
        // manager-authored-flow` sends from the manager's shell — source by
        // registry name, anchorThreadId from BB_THREAD_ID, hostId omitted
        // (inherited from the manager's environment), a fresh
        // clientRequestId per invocation.
        const run = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          anchorThreadId: manager.id,
          clientRequestId: randomUUID(),
          source: { type: "named", name: AUTHORED_WORKFLOW_NAME },
        });
        expect(run.anchorThreadId).toBe(manager.id);
        expect(run.hostId).toBe(harness.hostId);
        expect(run.workspacePath).toBe(workspacePath);
        expect(run.sourceTier).toBe("project");
        expect(run.workflowName).toBe(AUTHORED_WORKFLOW_NAME);

        // The run completes for real against the fake provider.
        const settled = await waitForPublicWorkflowRunTerminal(
          harness.api,
          run.id,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.status).toBe("completed");
        expect(settled.resultJson).toContain(AUTHORED_AGENT_PROMPT);

        // WAKE: the settlement message lands as a system-initiated turn
        // request on the manager thread, carrying the run id and the
        // fetch-the-result instruction...
        await waitForManagerAgentEcho(
          harness.api,
          manager.id,
          run.id,
          NOTIFICATION_TIMEOUT_MS,
        );
        await waitForThreadStatus(
          harness.api,
          manager.id,
          "idle",
          MANAGER_READY_TIMEOUT_MS,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, DUPLICATE_SETTLE_WINDOW_MS),
        );
        const settlementRequests = await listManagerWorkflowMessageRows({
          api: harness.api,
          runId: run.id,
          threadId: manager.id,
        });
        // ...exactly once across the whole loop — the settlement message is
        // the only manager message about this run (no interruption happened,
        // so no paused message either).
        expect(settlementRequests).toHaveLength(1);
        const settlement = settlementRequests[0];
        if (!settlement) {
          throw new Error("Expected the settlement turn request row");
        }
        expect(settlement.data.initiator).toBe("system");
        expect(managerWorkflowMessageText(settlement)).toContain(
          WORKFLOW_RUN_COMPLETED_MESSAGE_MARKER,
        );
        // The exit criterion's literal `[bb system]` settlement message: the
        // workflow messages render from @bb/templates with the same
        // internal-signal prefix every sibling manager system message
        // carries (M6 wording polish, applied in the review pass).
        expect(
          hasPrefixedWorkflowMessagePart(
            settlement,
            WORKFLOW_RUN_COMPLETED_MESSAGE_MARKER,
          ),
        ).toBe(true);
      }),
  );
});
