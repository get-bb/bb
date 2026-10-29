import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const output = join(process.env.RUNNER_TEMP, "git-reads-results");
mkdirSync(output, { recursive: true });
const file = "plugins/git/host/workspace-reads.test.ts";
const candidate = readFileSync(file);
const baselineSha = "bdf62012ef370c0cf5d0a25a056d861cabb00320";
const fetched = spawnSync("git", ["fetch", "--depth=1", "origin", baselineSha], { stdio: "inherit" });
if (fetched.status !== 0) throw new Error("Baseline fetch failed");
const baseline = spawnSync("git", ["show", `${baselineSha}:${file}`], { maxBuffer: 1024 * 1024 });
if (baseline.status !== 0) throw new Error("Baseline read failed");
const shard = JSON.parse(readFileSync("scripts/ci-test-shards.json", "utf8"))["windows-tests"].find((entry) => entry.shard === "plugins-2");
const sequence = process.env.BENCHMARK_ORDER;
if (sequence !== "ABBA" && sequence !== "BAAB") throw new Error("Unknown order");
const args = ["exec", "turbo", "run", "test", ...shard.filter.split(" "), "--force", "--continue", "--output-logs=full", "--summarize", `--concurrency=${shard.concurrency}`];
const results = [];
try {
  for (const [index, variant] of [...sequence].entries()) {
    writeFileSync(file, variant === "A" ? baseline.stdout : candidate);
    const fd = openSync(join(output, `${index}-${variant}.log`), "w");
    const started = performance.now();
    const result = spawnSync("pnpm", args, { shell: true, env: process.env, stdio: ["ignore", fd, fd] });
    const seconds = (performance.now() - started) / 1000;
    closeSync(fd);
    results.push({ variant, seconds, status: result.status, signal: result.signal, error: result.error?.message });
    writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.at(-1)));
    for (const summary of readdirSync(".turbo/runs")) copyFileSync(join(".turbo/runs", summary), join(output, `${index}-${variant}-${summary}`));
  }
} finally {
  writeFileSync(file, candidate);
}
if (results.some((result) => result.status !== 0)) process.exitCode = 1;
