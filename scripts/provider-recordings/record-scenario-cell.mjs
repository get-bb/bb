#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isolateAgentState } from "./isolate-agent-state.mjs";

const CELLS = [
  "settings-follow-up",
  "settings-steer",
  "steer-race",
  "provider-exit",
];
const USAGE =
  "usage: record-scenario-cell.mjs --provider <id> --cell <cell> --raw <dir> [--models <first>,<second>] [--race-trigger <trigger>]";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) {
      throw new Error(`bad argument ${argv[i]}\n${USAGE}`);
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  for (const required of ["provider", "cell", "raw"]) {
    if (!args[required]) throw new Error(`--${required} is required\n${USAGE}`);
  }
  if (!CELLS.includes(args.cell)) {
    throw new Error(`--cell must be one of ${CELLS.join(", ")}`);
  }
  return args;
}

function providerEnv(args) {
  const env = { ...process.env };
  if (env.CLAUDECODE !== undefined) {
    for (const name of Object.keys(env)) {
      if (name.startsWith("CLAUDE") || name === "ANTHROPIC_BASE_URL")
        delete env[name];
    }
  }
  env.BB_SCENARIO_RECORD_DIR = resolve(args.raw);
  env.BB_SCENARIO_RECORD_PROVIDER = args.provider;
  env.BB_SCENARIO_RECORD_CELL = args.cell;
  if (args.models) env.BB_SCENARIO_RECORD_MODELS = args.models;
  if (args["race-trigger"])
    env.BB_SCENARIO_RECORD_RACE_TRIGGER = args["race-trigger"];
  return env;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
mkdirSync(resolve(args.raw), { recursive: true });
execFileSync(
  "pnpm",
  [
    "exec",
    "turbo",
    "run",
    "//#ensure-native-modules",
    "@get-bb/plugin-sdk#build",
    "--output-logs=errors-only",
  ],
  { cwd: repoRoot, stdio: "inherit" },
);
const runtimeDir = join(repoRoot, "packages/agent-runtime");
const workspace = realpathSync(
  mkdtempSync(join(tmpdir(), `bb-conf-${args.cell}-`)),
);
const env = providerEnv(args);
env.BB_SCENARIO_RECORD_WORKSPACE = workspace;
const isolation = await isolateAgentState(args.provider, env, [
  workspace,
  runtimeDir,
]);
Object.assign(env, isolation.env);
let run;
process.on("SIGINT", () => {});
try {
  run = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "src/integration.record-scenario-cells.test.ts",
    ],
    {
      cwd: runtimeDir,
      env,
      stdio: "inherit",
    },
  );
} finally {
  await isolation.finish();
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(run.status ?? 1);
