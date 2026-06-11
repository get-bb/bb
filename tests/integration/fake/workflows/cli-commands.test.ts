// M4 authoring-loop coverage: the REAL `bb workflow save` handler (the
// production commander registration, not a re-implementation) copies a
// validated workflow into the daemon's user tier, the live registry re-list
// shows it at tier `user`, and a named launch through the public route runs
// it for real against the fake provider (sourceTier derived from the
// listing). The save command is imported directly (its import graph is
// commander + config + validation only); the CLI's list/run/wait/show
// handlers are covered by apps/cli unit tests — importing the full command
// group here would pull `@bb/sdk/node` into this package's TS program, where
// apps/host-daemon's ambient `ws` module stub conflicts with the real
// `@types/ws` the SDK is typed against (see ws.d.ts blocker note).

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  workflowListResponseSchema,
  workflowRunResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { registerWorkflowSaveCommand } from "../../../../apps/cli/src/commands/workflow/save.js";
import { expectStatus } from "../../helpers/api.js";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import { runWorkflowCli } from "../../helpers/workflow-cli.js";
import {
  waitForWorkflowRunStatus,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
} from "../../helpers/workflow-runs.js";

const SAVED_WORKFLOW_NAME = "cli-saved-flow";

/** Deterministic single-agent workflow the fake provider completes for real. */
const SAVED_WORKFLOW_SOURCE = `export const meta = {
  name: ${JSON.stringify(SAVED_WORKFLOW_NAME)},
  description: "CLI save/list/run integration fixture",
};

const result = await agent("do the cli work");
return { result };
`;

describe.sequential("workflow save CLI integration", () => {
  it(
    "saves to the daemon user tier, re-lists at tier user, and the saved workflow runs by name",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow CLI Save",
        });

        // save: the CLI validates, then copies into `<dataDir>/workflows` —
        // the exact directory the daemon's user-tier registry scan reads.
        const draftDir = await mkdtemp(join(tmpdir(), "bb-cli-workflow-"));
        const draftFile = join(draftDir, "draft.workflow.js");
        await writeFile(draftFile, SAVED_WORKFLOW_SOURCE, "utf8");
        vi.stubEnv("BB_DATA_DIR", harness.daemonDataDir);
        try {
          const save = await runWorkflowCli({
            argv: ["workflow", "save", draftFile],
            register: registerWorkflowSaveCommand,
          });
          expect(save.stdout.join("\n")).toContain(
            `Saved workflow '${SAVED_WORKFLOW_NAME}'`,
          );
        } finally {
          vi.unstubAllEnvs();
        }
        const savedPath = join(
          harness.daemonDataDir,
          "workflows",
          `${SAVED_WORKFLOW_NAME}.workflow.js`,
        );
        expect(await readFile(savedPath, "utf8")).toBe(SAVED_WORKFLOW_SOURCE);

        // Re-list through the live route (project-source resolution + daemon
        // `workflow.list` RPC): the saved workflow is now visible at tier
        // `user`, merged with the shipped builtins.
        const listResponse = await harness.api.workflows.$get({
          query: { projectId: project.id },
        });
        await expectStatus(listResponse, 200, "list workflows");
        const listings = workflowListResponseSchema.parse(
          await listResponse.json(),
        );
        const saved = listings.find(
          (workflow) => workflow.name === SAVED_WORKFLOW_NAME,
        );
        expect(saved?.tier).toBe("user");
        expect(listings.some((workflow) => workflow.tier === "builtin")).toBe(
          true,
        );

        // Launch BY NAME through the public route: named resolution finds the
        // user-tier source, derives sourceTier from the listing, and the fake
        // provider runs it to completion.
        const launchResponse = await harness.api["workflow-runs"].$post({
          json: {
            projectId: project.id,
            source: { type: "named", name: SAVED_WORKFLOW_NAME },
            hostId: harness.hostId,
          },
        });
        await expectStatus(launchResponse, 201, "launch saved workflow");
        const launched = workflowRunResponseSchema.parse(
          await launchResponse.json(),
        );
        expect(launched.workflowName).toBe(SAVED_WORKFLOW_NAME);
        expect(launched.sourceTier).toBe("user");

        const settled = await waitForWorkflowRunStatus(
          harness,
          launched.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.resultJson).toContain("Response to:");
      }),
  );
});
