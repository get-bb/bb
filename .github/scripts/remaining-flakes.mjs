import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
const lane = process.env.PROBE_LANE;
const output = join(process.env.RUNNER_TEMP, "remaining-flakes");
mkdirSync(output, { recursive: true });
const results = [];
const pkg = {
  identity: "@bb/config",
  crash: "@bb/integration-tests",
  freshness: "bb-plugin-bb--github-pr-status",
}[lane];
const target = {
  identity: "test/verified-process-stop.test.ts",
  crash: "fake/recovery/active-crash-recovery.test.ts",
  freshness: "store.test.ts",
}[lane];
function run(name, args, env = {}) {
  const logPath = join(output, name + ".log");
  const fd = openSync(logPath, "w");
  const start = Date.now();
  const result = spawnSync("pnpm", args, {
    shell: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, ...env },
    timeout: 600000,
  });
  closeSync(fd);
  const log = readFileSync(logPath, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  const row = {
    name,
    status: result.status,
    error: result.error?.message,
    durationMs: Date.now() - start,
    diagnostics: log
      .split("\n")
      .filter((line) =>
        /IDENTITY_|FRESHNESS_|OWNED_|CRASH_|REMOVE_|OPEN_HANDLES|HARNESS_SHUTDOWN|Tests\s|Test Files/.test(
          line,
        ),
      ),
  };
  results.push(row);
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(name, row.status, row.durationMs);
  return result.status;
}
const turbo = [
  "exec",
  "turbo",
  "run",
  "test",
  "--filter=" + pkg,
  "--force",
  "--",
  "--silent=false",
];
run("warm", [...turbo, target], {
  VITEST_MAX_WORKERS: lane === "crash" ? "4" : "2",
});
for (let i = 0; i < 15; i++)
  run(
    "focused-" + i,
    [
      "--filter",
      pkg,
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.config.ts",
      target,
      "--silent=false",
    ],
    { VITEST_MAX_WORKERS: "2" },
  );
const foundation = [
  "@bb/process-utils",
  "@bb/host-workspace",
  "@bb/host-watcher",
  "@bb/agent-runtime",
  "@bb/provider-bridge-protocol",
  "@bb/provider-bridge-acp",
  "@bb/host-daemon-contract",
  "@bb/config",
  "@bb/db",
];
const filters =
  lane === "identity"
    ? foundation.map((p) => "--filter=" + p)
    : lane === "crash"
      ? ["--filter=" + pkg]
      : [
          "--filter=bb-plugin-*",
          "--filter=!bb-plugin-provider-*",
          "--filter=!bb-plugin-tasks",
          "--filter=!bb-plugin-connect",
          "--filter=!bb-plugin-thread-list",
        ];
for (let i = 0; i < 3; i++)
  run(
    "full-" + i,
    [
      "exec",
      "turbo",
      "run",
      "test",
      ...filters,
      "--force",
      "--continue",
      "--concurrency=2",
      "--",
      "--silent=false",
    ],
    lane === "crash"
      ? { VITEST_MAX_WORKERS: "4" }
      : lane === "freshness"
        ? { VITEST_MAX_WORKERS: "2" }
        : {},
  );
