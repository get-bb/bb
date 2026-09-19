import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin from "./server.js";

const DOCUMENTATION_EXTENSIONS = new Set([
  ".cjs",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
]);
const IGNORED_DOCUMENTATION_DIRECTORIES = new Set([
  "coverage",
  "dist",
  "node_modules",
]);

function isScannableDirectory(name: string): boolean {
  return !name.startsWith(".") && !IGNORED_DOCUMENTATION_DIRECTORIES.has(name);
}

function readIfPresent(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function documentationFiles(root: string): string[] {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (isScannableDirectory(entry.name)) {
          pending.push(path);
        }
      } else if (
        entry.isFile() &&
        DOCUMENTATION_EXTENSIONS.has(extname(entry.name))
      ) {
        files.push(path);
      }
    }
  }
  return files;
}

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
      argv: ["run", "--script", "source", "--resuem", "old-run"],
      error: "unknown option '--resuem' (Did you mean --resume?)",
    },
    {
      argv: ["run", "--script", "source", "extra"],
      error: "unexpected argument 'extra'",
    },
    {
      argv: ["validate", "--script", "one", "--script", "two"],
      error: "--script was given more than once; it takes a single value",
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
      argv: ["validate", "--file"],
      error: "--file requires a value",
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
      argv: ["list", "--limit", "2", "--limit", "3"],
      error: "--limit was given more than once; it takes a single value",
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
    {
      argv: ["statsu", "run-1"],
      error: "unknown command 'statsu' (Did you mean status?)",
    },
  ])("rejects malformed invocation $argv", async ({ argv, error }) => {
    const result = await harness.runCli(argv);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.split("\n")[0]).toContain(error);
    expect(result.stdout).toBe("");
  });

  it("parses inline option values instead of rejecting them", async () => {
    await expect(harness.runCli(["list", "--limit=2"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "This command must run inside a BB project thread\n",
    });
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

  it("keeps the removed workflow-specific catalog command out of project documentation", () => {
    const root = resolve(process.cwd(), "../..");
    const removedCommand = ["bb workflows", "catalog"].join(" ");
    const matches = documentationFiles(root)
      .filter((path) => readIfPresent(path).includes(removedCommand))
      .map((path) => relative(root, path))
      .sort();
    expect(matches).toEqual([]);
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
