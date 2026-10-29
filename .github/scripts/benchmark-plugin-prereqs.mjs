import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const output = join(process.env.RUNNER_TEMP, "plugin-prereq-results");
const seed = join(process.env.RUNNER_TEMP, "plugin-prereq-seed");
const cache = join(process.env.RUNNER_TEMP, "plugin-prereq-trial-cache");
const order = process.env.BENCHMARK_ORDER;
if (order !== "ABBA" && order !== "BAAB") throw new Error("Invalid order");
mkdirSync(output, { recursive: true });
const shard = JSON.parse(readFileSync("scripts/ci-test-shards.json", "utf8"))["windows-tests"].find((item) => item.shard === "plugins-2");
if (shard.concurrency !== 2) throw new Error("Unexpected concurrency");
const filters = shard.filter.split(" ");
const common = ["--cache=local:rw", "--concurrency=2", "--output-logs=full", "--summarize"];
const results = [];
function execute(args, name) {
  const runsDir = join(root, ".turbo/runs");
  const before = new Set(existsSync(runsDir) ? readdirSync(runsDir) : []);
  const fd = openSync(join(output, `${name}.log`), "w");
  const start = performance.now();
  const result = spawnSync("pnpm", args, { shell: true, stdio: ["ignore", fd, fd], env: process.env });
  closeSync(fd);
  const seconds = (performance.now() - start) / 1000;
  if (existsSync(runsDir)) {
    for (const file of readdirSync(runsDir)) {
      if (!before.has(file)) copyFileSync(join(runsDir, file), join(output, `${name}-${file}`));
    }
  }
  return { seconds, status: result.status, signal: result.signal, error: result.error?.message };
}
const seeded = execute(["exec", "turbo", "run", "generate", "generate:templates", "generate:plugin-scaffold", "generate:profile-worker", "--filter=@bb/plugin-build", "--filter=@bb/templates", "--filter=@bb/process-utils", `--cache-dir=${seed}`, ...common], "seed");
if (seeded.status !== 0) throw new Error("Generator seed failed");
const listed = spawnSync("pnpm", ["list", ...filters, "--depth=-1", "--json"], { shell: true, encoding: "utf8" });
if (listed.status !== 0) throw new Error(listed.stderr);
const packages = JSON.parse(listed.stdout);
writeFileSync(join(output, "packages.json"), JSON.stringify(packages, null, 2));
for (const [index, variant] of [...order].entries()) {
  rmSync(cache, { recursive: true, force: true });
  cpSync(seed, cache, { recursive: true });
  rmSync("packages/plugin-sdk/dist", { recursive: true, force: true });
  for (const pkg of packages) {
    rmSync(join(pkg.path, "node_modules/.vite/vitest"), { recursive: true, force: true });
    rmSync(join(pkg.path, ".turbo/scheduling-tests.json"), { force: true });
  }
  const start = performance.now();
  const preparation = variant === "B" ? execute(["exec", "turbo", "run", "build", "--filter=@get-bb/plugin-sdk", `--cache-dir=${cache}`, ...common], `${index}-${variant}-prepare`) : null;
  const test = preparation && preparation.status !== 0 ? null : execute(["exec", "turbo", "run", "test", ...filters, `--cache-dir=${cache}`, ...common, "--continue", "--", "--reporter=json", "--outputFile=.turbo/scheduling-tests.json"], `${index}-${variant}-test`);
  const seconds = (performance.now() - start) / 1000;
  const reports = join(output, `${index}-${variant}-reports`);
  mkdirSync(reports, { recursive: true });
  for (const pkg of packages) {
    const report = join(pkg.path, ".turbo/scheduling-tests.json");
    if (existsSync(report)) copyFileSync(report, join(reports, `${pkg.name}.json`));
  }
  results.push({ index, variant, seconds, preparation, test });
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}
if (results.some((trial) => !trial.test || trial.test.status !== 0)) process.exitCode = 1;
