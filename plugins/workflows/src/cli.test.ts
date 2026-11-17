import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin from "./server.js";

const SCRIPT = `export const meta = {
  name: "headless-start",
  description: "Started from explicit context flags",
};
return args;`;

describe("workflows CLI argument validation", () => {
  let harness: ReturnType<typeof createFakePluginHost>["harness"];

  beforeEach(async () => {
    const host = createFakePluginHost({
      pluginId: "workflows",
      agentSkillIds: ["workflows"],
    });
    harness = host.harness;
    await plugin(host.bb);
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it.each([
    {
      argv: ["run", "--script", "source", "extra"],
      error: "unexpected argument 'extra'",
    },
    {
      argv: ["validate"],
      error: "missing required options: one of --script, --file, --name",
    },
    {
      argv: ["validate", "--script", "one", "--file", "two"],
      error: "--script and --file cannot be combined",
    },
    {
      argv: ["status", "run-1", "run-2"],
      error: "unexpected argument 'run-2'",
    },
    {
      argv: ["status", "run-1", "--limit", "2"],
      error: "unknown option '--limit'",
    },
    {
      argv: ["list", "--origin-thread", "thr-1"],
      error: "unknown option '--origin-thread'",
    },
    {
      argv: ["history", "run-1", "--cursor", "-1"],
      error:
        "invalid value '-1' for --cursor. Expected an integer between 0 and 9007199254740991",
    },
    {
      argv: ["history", "run-1", "--limit", "101"],
      error:
        "invalid value '101' for --limit. Expected an integer between 1 and 100",
    },
    {
      argv: ["history", "run-1", "--limit", "1e2"],
      error:
        "invalid value '1e2' for --limit. Expected an integer between 1 and 100",
    },
    {
      argv: ["list", "--limit", "51"],
      error:
        "invalid value '51' for --limit. Expected an integer between 1 and 50",
    },
    {
      argv: ["list", "extra"],
      error: "unexpected argument 'extra'",
    },
    {
      argv: ["stop"],
      error: "missing required arguments: <run-id>",
    },
  ])("rejects malformed invocation $argv", async ({ argv, error }) => {
    const result = await harness.runCli(argv);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.split("\n")[0]).toContain(error);
    expect(result.stdout).toBe("");
  });

  it("reports a failure as a JSON envelope when the invocation carries --json", async () => {
    const result = await harness.runCli(["status", "run-1", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: "command_failed",
        message: "This command must run inside a BB project thread",
      },
    });
    expect(result.stderr).toBe(
      "This command must run inside a BB project thread\n",
    );
  });

  it("starts a run from explicit context flags and overrides the attached thread context", async () => {
    harness.sdk.stub("projects.get", () => ({ id: "proj-1" }));
    harness.sdk.stub("threads.get", () => ({
      id: "thr-1",
      projectId: "proj-1",
      environmentId: "env-1",
      providerId: "prov-1",
      archivedAt: null,
    }));
    harness.sdk.stub("environments.get", () => ({
      id: "env-1",
      projectId: "proj-1",
      hostId: "host-1",
      path: "/workspace",
    }));
    harness.sdk.stub("threads.defaultExecutionOptions", () => ({
      model: "model-1",
      reasoningLevel: "medium",
      permissionMode: "auto",
    }));

    const result = await harness.runCli(
      [
        "run",
        "--script",
        SCRIPT,
        "--project",
        "proj-1",
        "--origin-thread",
        "thr-1",
        "--args",
        '{"request":"review"}',
      ],
      { projectId: "proj-ctx", threadId: "thr-ctx" },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const started = JSON.parse(result.stdout) as {
      runId: string;
      name: string;
      status: string;
    };
    expect(started.runId).toMatch(/^wfr_/);
    expect(started.name).toBe("headless-start");
    expect(started.status).toBe("queued");
    expect(harness.sdk.callsTo("projects.get")).toEqual([
      [{ projectId: "proj-1" }],
    ]);

    const listed = await harness.runCli(["list", "--project", "proj-1"]);
    expect(listed.exitCode).toBe(0);
    const runs = JSON.parse(listed.stdout) as Array<{ id: string }>;
    expect(runs.map((run) => run.id)).toEqual([started.runId]);

    const scopedElsewhere = await harness.runCli(["list"], {
      projectId: "proj-ctx",
    });
    expect(scopedElsewhere.exitCode).toBe(0);
    expect(JSON.parse(scopedElsewhere.stdout)).toEqual([]);

    const status = await harness.runCli([
      "status",
      started.runId,
      "--project",
      "proj-1",
    ]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      id: started.runId,
      originThreadId: "thr-1",
    });

    const unknownElsewhere = await harness.runCli([
      "status",
      started.runId,
      "--project",
      "proj-2",
    ]);
    expect(unknownElsewhere.exitCode).toBe(1);
    expect(unknownElsewhere.stderr).toContain("Unknown workflow run");
  });

  it("rejects a headless run whose origin thread is archived", async () => {
    harness.sdk.stub("projects.get", () => ({ id: "proj-1" }));
    harness.sdk.stub("threads.get", () => ({
      id: "thr-1",
      projectId: "proj-1",
      environmentId: "env-1",
      providerId: "prov-1",
      archivedAt: Date.now(),
    }));
    harness.sdk.stub("environments.get", () => ({
      id: "env-1",
      projectId: "proj-1",
      hostId: "host-1",
      path: "/workspace",
    }));

    const result = await harness.runCli([
      "run",
      "--script",
      SCRIPT,
      "--project",
      "proj-1",
      "--origin-thread",
      "thr-1",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Workflow origin thread is archived");
  });

  it("rejects a headless run whose origin thread belongs to another project", async () => {
    harness.sdk.stub("projects.get", () => ({ id: "proj-1" }));
    harness.sdk.stub("threads.get", () => ({
      id: "thr-1",
      projectId: "proj-other",
      environmentId: "env-1",
      providerId: "prov-1",
      archivedAt: null,
    }));
    harness.sdk.stub("environments.get", () => ({
      id: "env-1",
      projectId: "proj-other",
      hostId: "host-1",
      path: "/workspace",
    }));

    const result = await harness.runCli([
      "run",
      "--script",
      SCRIPT,
      "--project",
      "proj-1",
      "--origin-thread",
      "thr-1",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Workflow origin thread belongs to a different project",
    );
  });

  it("prefers the explicit project flag over the attached thread context", async () => {
    harness.sdk.stub("projects.get", () => ({ id: "proj-flag" }));

    const result = await harness.runCli(["list", "--project", "proj-flag"], {
      projectId: "proj-ctx",
      threadId: "thr-ctx",
    });

    expect(result.exitCode).toBe(0);
    expect(harness.sdk.callsTo("projects.get")).toEqual([
      [{ projectId: "proj-flag" }],
    ]);
  });

  it("rejects an explicit project that is not available", async () => {
    harness.sdk.stub("projects.get", () => {
      throw new Error("no such project");
    });

    const result = await harness.runCli(["list", "--project", "proj-missing"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Project proj-missing is not available: no such project",
    );
  });

  it("names the missing context flag when only one is passed outside a thread", async () => {
    const missingThread = await harness.runCli([
      "run",
      "--script",
      SCRIPT,
      "--project",
      "proj-1",
    ]);
    expect(missingThread.exitCode).toBe(1);
    expect(missingThread.stderr.split("\n")[0]).toContain(
      "missing required option --origin-thread",
    );

    const missingProject = await harness.runCli([
      "run",
      "--script",
      SCRIPT,
      "--origin-thread",
      "thr-1",
      "--json",
    ]);
    expect(missingProject.exitCode).toBe(1);
    expect(JSON.parse(missingProject.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "missing_required",
        message: "missing required option --project",
      },
    });
  });

  it.each([["--help"], ["help"], ["history", "--help"]])(
    "documents %s without running a command",
    async (...argv) => {
      const result = await harness.runCli(argv);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bb workflows history");
      expect(result.stderr).toBe("");
    },
  );

  it("keeps one author tool and the shared Claude workflow language", async () => {
    expect(harness.registrations.agentTools.map((tool) => tool.name)).toEqual([
      "bb_workflow_run",
      "bb_workflow_result",
    ]);
    expect(
      harness.registrations.cli?.commands.map((command) => command.name),
    ).toEqual(["run", "validate", "status", "history", "list", "stop"]);
    const run = harness.registrations.agentTools.find(
      (tool) => tool.name === "bb_workflow_run",
    );
    expect(run?.description).toBe(
      "Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a run ID and a `previewDirective`. After a successful call, emit that directive exactly once on its own line (not in a code fence) so BB renders live progress in chat. A completion notification is sent to the origin thread. Use `bb workflows status <run-id>` for a compact summary. For detailed history, redirect a bounded JSONL page from `bb workflows history <run-id> --cursor <call-index> --limit <1-100>` into `$BB_THREAD_STORAGE`, then inspect the file with normal filesystem tools.",
    );
    expect(run?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        script: {
          description:
            "Self-contained workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal, no computed values) followed by the script body using agent()/parallel()/pipeline()/phase().",
        },
        args: {
          description:
            "Optional input value exposed to the script as the global `args`, verbatim. Pass arrays/objects as actual JSON values, NOT as a JSON-encoded string — a stringified list breaks `args.filter`/`args.map` in the script. Use for parameterized named workflows (e.g. a research question).",
        },
      },
    });

    const result = harness.registrations.agentTools.find(
      (tool) => tool.name === "bb_workflow_result",
    );
    expect(result?.description).toBe(
      'Use this tool to return your final response in the requested structured format. You MUST call this tool exactly once at the end of your response with {"value": ...} to provide the structured output.',
    );

    const author = await harness.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    expect(author.tools.map((tool) => tool.name)).toEqual(["bb_workflow_run"]);
    expect(author.skills).toEqual(["workflows"]);
  });
});

describe("workflows agent-tool boundary schemas", () => {
  it.each([
    ["bb_workflow_run", { script: "return null", extra: true }],
    ["bb_workflow_result", { value: null, extra: true }],
  ])("rejects extra fields for %s", async (tool, input) => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "workflows",
      agentSkillIds: ["workflows"],
    });
    await plugin(bb);
    await expect(harness.callAgentTool(tool, input)).rejects.toThrow(
      `tool "${tool}" arguments are invalid`,
    );
    await harness.dispose();
  });
});
