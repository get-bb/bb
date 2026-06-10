// M3 exit criterion (l), the row-level half deferred from M2: a workflow
// agent session's shell invoking `bb thread spawn` / `bb workflow run` fails
// through the daemon-materialized failing shim, and the server DB shows no
// new `threads` or `workflow_runs` rows afterward. The shim directory is the
// REAL artifact the harness daemon wrote at boot (the same one
// prepareWorkflowAgentShellEnv prepends to every workflowAgent session's
// PATH), and the running harness server is live the whole time — so if a real
// bb ever executed, it could have minted rows.

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import {
  countStoredThreads,
  countStoredWorkflowRuns,
} from "../../helpers/queries.js";

interface ShellResult {
  code: number;
  stderr: string;
  stdout: string;
}

/**
 * Runs a command the way a workflow agent's shell would see it: the shim
 * directory shadowing PATH and no server coordinates in the environment
 * (the restricted base env carries no BB_SERVER_URL / BB_THREAD_ID).
 */
function runInWorkflowAgentShell(
  shimDirectoryPath: string,
  command: string,
): Promise<ShellResult> {
  return new Promise((resolve) => {
    execFile(
      "/bin/sh",
      ["-c", command],
      {
        env: {
          PATH: `${shimDirectoryPath}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error && typeof error.code === "number" ? error.code : 0,
          stderr,
          stdout,
        });
      },
    );
  });
}

describe.sequential("workflow agent no-nesting integration", () => {
  it.runIf(process.platform !== "win32")(
    "blocked nested bb invocations create no thread or workflow-run rows (exit criterion l)",
    () =>
      withHarness(async (harness) => {
        // A real project exists so a real bb with server access could have
        // created threads/runs — the assertion below is therefore meaningful.
        await createProjectFixture(harness, { name: "Workflow No Nesting" });

        // The REAL shim the daemon materialized at boot for workflowAgent
        // session shells.
        const shimDirectoryPath = join(
          harness.daemonDataDir,
          "workflow-agent-shim",
        );
        await stat(join(shimDirectoryPath, "bb"));

        const threadsBefore = countStoredThreads(harness.db);
        const runsBefore = countStoredWorkflowRuns(harness.db);

        for (const nestedCommand of [
          "bb thread spawn nested-work",
          "bb workflow run integration-flow",
        ]) {
          const result = await runInWorkflowAgentShell(
            shimDirectoryPath,
            nestedCommand,
          );
          expect(result.code).not.toBe(0);
          expect(result.stderr).toContain(
            "not available inside workflow agent sessions",
          );
        }

        expect(countStoredThreads(harness.db)).toBe(threadsBefore);
        expect(countStoredWorkflowRuns(harness.db)).toBe(runsBefore);
      }),
  );
});
