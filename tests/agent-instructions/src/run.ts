import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  buildAgentInstructions,
  enabledContexts,
  loadPluginAgentContexts,
  REPO_ROOT,
  type PluginAgentContext,
} from "./agent-context.js";
import { loadCases, type EvalCase } from "./cases.js";
import {
  casePassed,
  gradeObservation,
  observeStream,
  type CheckResult,
} from "./grade.js";

const GUIDE_TEMPLATES = join(REPO_ROOT, "packages/templates/src/templates");
const SAMPLE_TIMEOUT_MS = 300_000;

const DEFAULT_STATUS = [
  "Project: app (proj_eval)",
  "",
  "Thread: thr_eval_self",
  "  Status: active",
  "  Title: Eval thread",
  "  Environment: Project checkout (env_eval)",
  "",
  "Data dir: /home/user/.bb",
].join("\n");

const FAKE_BB = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(process.env.BB_EVAL_CONFIG, "utf8"));
const args = process.argv.slice(2);
let stdin = "";
if (args.includes("-") || args.includes("--message-file")) {
  try { stdin = fs.readFileSync(0, "utf8"); } catch {}
}
fs.appendFileSync(config.log, JSON.stringify({ args, stdin }) + "\\n");
const line = args.join(" ");
for (const response of config.responses) {
  if (new RegExp(response.args).test(line)) {
    process.stdout.write(response.stdout + "\\n");
    process.exit(response.exitCode);
  }
}
if (args[0] === "status") {
  process.stdout.write(config.status + "\\n");
  process.exit(0);
}
if (args[0] === "guide") {
  const chapter = args[1] && !args[1].startsWith("-") ? args[1] : "overview";
  const file = path.join(config.guideDir, "bb-guide-" + chapter + ".md");
  if (fs.existsSync(file)) {
    process.stdout.write(fs.readFileSync(file, "utf8"));
    process.exit(0);
  }
  process.stderr.write("Unknown guide chapter: " + chapter + "\\n");
  process.exit(1);
}
process.stdout.write("OK\\n");
`;

const FAKE_MCP = `#!/usr/bin/env node
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === "") continue;
    const request = JSON.parse(line);
    if (request.id === undefined) continue;
    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "bb-bridge", version: "1.0.0" },
      } });
    } else if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: config.tools } });
    } else if (request.method === "tools/call") {
      const canned = config.results.find((entry) => entry.tool === request.params.name);
      send({ jsonrpc: "2.0", id: request.id, result: {
        content: [{ type: "text", text: canned ? canned.result : "{\\"ok\\":true}" }],
      } });
    } else {
      send({ jsonrpc: "2.0", id: request.id, result: {} });
    }
  }
});
`;

interface SampleResult {
  caseId: string;
  sample: number;
  passed: boolean;
  checks: CheckResult[];
  bbCalls: string[];
  commands: string[];
  skills: string[];
  final: string;
  costUsd: number | null;
  error: string | null;
}

const resultEventSchema = z.object({
  type: z.literal("result"),
  total_cost_usd: z.number().optional(),
  is_error: z.boolean().optional(),
});

const bbLogLineSchema = z.object({
  args: z.array(z.string()),
  stdin: z.string(),
});

function writeSkillPlugin(
  dir: string,
  contexts: readonly PluginAgentContext[],
) {
  const pluginDir = join(dir, "bb-global-skills");
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginDir, "skills"), { recursive: true });
  writeFileSync(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "bb-global-skills",
      version: "0.1.0",
      description: "Skills injected by bb.",
      author: { name: "bb" },
      skills: "./skills",
    }),
  );
  for (const skill of contexts.flatMap((context) => context.skills)) {
    symlinkSync(skill.path, join(pluginDir, "skills", skill.name), "dir");
  }
  return pluginDir;
}

const CLAUDE_AUTH_ENV =
  /^CLAUDE_CODE_(OAUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY)$/;

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("BB_")) continue;
    if (key.startsWith("CLAUDE_CODE_") && !CLAUDE_AUTH_ENV.test(key)) continue;
    if (key === "CLAUDECODE" || key === "GH_TOKEN") continue;
    env[key] = value;
  }
  return { ...env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ...extra };
}

async function runSample(args: {
  evalCase: EvalCase;
  sample: number;
  contexts: readonly PluginAgentContext[];
  model: string;
  maxTurns: number;
  withoutBbText: boolean;
}): Promise<SampleResult> {
  const { evalCase } = args;
  const root = mkdtempSync(join(tmpdir(), `bb-agent-eval-${evalCase.id}-`));
  try {
    const workspace = join(root, "workspace");
    const bin = join(root, "bin");
    const storage = join(root, "storage");
    for (const dir of [workspace, bin, storage]) mkdirSync(dir);
    for (const [path, content] of Object.entries(evalCase.files)) {
      const target = join(workspace, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const enabled = enabledContexts(args.contexts, evalCase.plugins);
    const skillPlugin = writeSkillPlugin(root, enabled);
    const log = join(root, "bb-calls.jsonl");
    writeFileSync(log, "");
    const config = join(root, "bb-config.json");
    writeFileSync(
      config,
      JSON.stringify({
        log,
        guideDir: GUIDE_TEMPLATES,
        status: evalCase.bb.status ?? DEFAULT_STATUS,
        responses: evalCase.bb.responses,
      }),
    );
    writeFileSync(join(bin, "bb"), FAKE_BB);
    chmodSync(join(bin, "bb"), 0o755);
    const tools = enabled.flatMap((context) => context.tools);
    const mcpArgs: string[] = [];
    if (tools.length > 0) {
      const mcpServer = join(root, "fake-mcp.cjs");
      const mcpServerConfig = join(root, "fake-mcp.json");
      writeFileSync(mcpServer, FAKE_MCP);
      writeFileSync(
        mcpServerConfig,
        JSON.stringify({
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: JSON.parse(tool.schemaJson),
          })),
          results: evalCase.toolResults,
        }),
      );
      const mcpConfig = join(root, "mcp.json");
      writeFileSync(
        mcpConfig,
        JSON.stringify({
          mcpServers: {
            "bb-bridge": {
              command: process.execPath,
              args: [mcpServer, mcpServerConfig],
            },
          },
        }),
      );
      mcpArgs.push("--mcp-config", mcpConfig);
    }
    const allowedTools = [
      "Bash(bb:*)",
      "Bash(bb *)",
      `Read(/${root}/**)`,
      `Read(/${join(REPO_ROOT, "plugins")}/*/skills/**)`,
      "Skill",
      ...(tools.length > 0 ? ["mcp__bb-bridge"] : []),
      ...(evalCase.allowEdits
        ? [`Edit(/${workspace}/**)`, `Write(/${workspace}/**)`]
        : []),
    ];
    const claudeArgs = [
      "-p",
      evalCase.prompt,
      "--append-system-prompt",
      args.withoutBbText ? "" : buildAgentInstructions(enabled),
      "--plugin-dir",
      skillPlugin,
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      ...mcpArgs,
      "--model",
      args.model,
      "--max-turns",
      String(args.maxTurns),
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      ...allowedTools,
    ];
    const lines = await new Promise<string[]>((resolvePromise, reject) => {
      const child = spawn("claude", claudeArgs, {
        cwd: workspace,
        env: childEnv({
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          BB_EVAL_CONFIG: config,
          BB_THREAD_ID: "thr_eval_self",
          BB_THREAD_STORAGE: storage,
        }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Timed out after ${SAMPLE_TIMEOUT_MS / 1000}s`));
      }, SAMPLE_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        const output = stdout.split("\n").filter((line) => line.trim() !== "");
        if (code !== 0 && !output.some((line) => line.includes('"result"'))) {
          reject(new Error(`claude exited ${code}: ${stderr.slice(-500)}`));
          return;
        }
        resolvePromise(output);
      });
    });
    const bbCalls = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const call = bbLogLineSchema.parse(JSON.parse(line));
        return [call.args.join(" "), call.stdin].filter(Boolean).join("\n");
      });
    const observation = observeStream(lines, bbCalls);
    const checks = gradeObservation(evalCase.checks, observation);
    const result = lines
      .map((line) => resultEventSchema.safeParse(JSON.parse(line)))
      .find((parsed) => parsed.success)?.data;
    return {
      caseId: evalCase.id,
      sample: args.sample,
      passed: checks.every((check) => check.passed),
      checks,
      bbCalls: observation.bbCalls,
      commands: observation.commands,
      skills: observation.skills,
      final: observation.final,
      costUsd: result?.total_cost_usd ?? null,
      error: null,
    };
  } catch (error) {
    return {
      caseId: evalCase.id,
      sample: args.sample,
      passed: false,
      checks: [],
      bbCalls: [],
      commands: [],
      skills: [],
      final: "",
      costUsd: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runPool<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]!();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

const baselineRowSchema = z.object({
  caseId: z.string(),
  passed: z.boolean(),
  error: z.string().nullable(),
});

function readPassRates(path: string): Map<string, boolean[]> {
  const rates = new Map<string, boolean[]>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const row = baselineRowSchema.parse(JSON.parse(line));
    if (row.error !== null) continue;
    rates.set(row.caseId, [...(rates.get(row.caseId) ?? []), row.passed]);
  }
  return rates;
}

function rate(passes: readonly boolean[] | undefined): string {
  if (passes === undefined || passes.length === 0) return "-";
  return `${passes.filter(Boolean).length}/${passes.length}`;
}

function summarize(args: {
  cases: readonly EvalCase[];
  results: readonly SampleResult[];
  baseline: Map<string, boolean[]> | null;
  model: string;
  systemTextChars: number;
}): string {
  const lines = [
    `# Agent instructions eval`,
    "",
    `Model: ${args.model}. bb system text: ${args.systemTextChars} chars.`,
    "",
    `| Case | Kind | Passed | ${args.baseline === null ? "" : "Baseline | "}Failed checks |`,
    `| --- | --- | --- | ${args.baseline === null ? "" : "--- | "}--- |`,
  ];
  let failedCases = 0;
  for (const evalCase of args.cases) {
    const samples = args.results.filter(
      (result) => result.caseId === evalCase.id && result.error === null,
    );
    const passes = samples.map((sample) => sample.passed);
    const passed = passes.length > 0 && casePassed(passes);
    if (!passed) failedCases += 1;
    const failedChecks = [
      ...new Set(
        samples.flatMap((sample) =>
          sample.checks
            .filter((check) => !check.passed)
            .map((check) => check.label),
        ),
      ),
    ].join("; ");
    lines.push(
      `| ${evalCase.id} | ${evalCase.kind} | ${rate(passes)}${passed ? "" : " FAIL"} | ${args.baseline === null ? "" : `${rate(args.baseline.get(evalCase.id))} | `}${failedChecks} |`,
    );
  }
  const errors = args.results.filter((result) => result.error !== null);
  const cost = args.results.reduce(
    (sum, result) => sum + (result.costUsd ?? 0),
    0,
  );
  lines.push(
    "",
    `Cases failed: ${failedCases} of ${args.cases.length}. Samples with errors (left out): ${errors.length}. Cost: $${cost.toFixed(2)}.`,
  );
  for (const error of errors) {
    lines.push(`- ${error.caseId} sample ${error.sample}: ${error.error}`);
  }
  return `${lines.join("\n")}\n`;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = z.coerce.number().int().positive().safeParse(value);
  if (!parsed.success) throw new Error(`${flag} needs a positive integer`);
  return parsed.data;
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      model: { type: "string", default: "sonnet" },
      case: { type: "string", multiple: true },
      samples: { type: "string", default: "3" },
      concurrency: { type: "string", default: "4" },
      "max-turns": { type: "string", default: "15" },
      baseline: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "without-bb-text": { type: "boolean", default: false },
    },
  });
  const allCases = loadCases();
  const selected = values.case;
  const cases =
    selected === undefined
      ? allCases
      : allCases.filter((evalCase) => selected.includes(evalCase.id));
  if (cases.length === 0) throw new Error("No cases selected");
  const contextsByParent = new Map<string | null, PluginAgentContext[]>();
  for (const parentThreadId of new Set([
    null,
    ...cases.map((evalCase) => evalCase.parentThreadId),
  ])) {
    contextsByParent.set(
      parentThreadId,
      await loadPluginAgentContexts({ parentThreadId }),
    );
  }
  const contextsFor = (evalCase: EvalCase) =>
    contextsByParent.get(evalCase.parentThreadId) ?? [];
  const systemText = buildAgentInstructions(
    enabledContexts(contextsByParent.get(null) ?? []),
  );
  if (values["dry-run"]) {
    for (const evalCase of cases) {
      console.log(`${evalCase.id}: ${evalCase.checks.length} checks`);
    }
    console.log(`bb system text: ${systemText.length} chars`);
    return;
  }
  if (values.out === undefined) throw new Error("--out <dir> is required");
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  const samples = positiveInteger(values.samples, "--samples");
  const tasks = cases.flatMap((evalCase) =>
    Array.from({ length: samples }, (_, sample) => async () => {
      const result = await runSample({
        evalCase,
        sample,
        contexts: contextsFor(evalCase),
        model: values.model,
        maxTurns: positiveInteger(values["max-turns"], "--max-turns"),
        withoutBbText: values["without-bb-text"],
      });
      console.log(
        `${result.caseId} #${sample}: ${
          result.error ??
          (result.passed
            ? "pass"
            : `fail (${result.checks
                .filter((check) => !check.passed)
                .map((check) => check.label)
                .join("; ")})`)
        }`,
      );
      return result;
    }),
  );
  const results = await runPool(
    tasks,
    positiveInteger(values.concurrency, "--concurrency"),
  );
  writeFileSync(
    join(out, "results.jsonl"),
    results.map((result) => JSON.stringify(result)).join("\n") + "\n",
  );
  const summary = summarize({
    cases,
    results,
    baseline:
      values.baseline !== undefined && existsSync(values.baseline)
        ? readPassRates(values.baseline)
        : null,
    model: values.model,
    systemTextChars: values["without-bb-text"] ? 0 : systemText.length,
  });
  writeFileSync(join(out, "summary.md"), summary);
  console.log(`\n${summary}`);
}

await main();
