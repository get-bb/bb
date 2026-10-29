import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const output = join(process.env.RUNNER_TEMP, "app-shard-results");
mkdirSync(output, { recursive: true });
const file = "apps/app/vitest.config.ts";
const candidate = readFileSync(file);
const baselineSha = "214616a884e5baf46cf82e331138016725ca2bc9";
const fetched = spawnSync("git", ["fetch", "--depth=1", "origin", baselineSha], { stdio: "inherit" });
if (fetched.status !== 0) throw new Error("Baseline fetch failed");
const baseline = spawnSync("git", ["show", `${baselineSha}:${file}`], { maxBuffer: 1024 * 1024 });
if (baseline.status !== 0) throw new Error("Baseline read failed");
const sequence = process.env.BENCHMARK_ORDER;
if (sequence !== "ABBA" && sequence !== "BAAB") throw new Error("Unknown order");
const results = [];
try {
  for (const [index, variant] of [...sequence].entries()) {
    writeFileSync(file, variant === "A" ? baseline.stdout : candidate);
    const report = join(output, `${index}-${variant}-tests.json`).replaceAll("\\", "/");
    const fd = openSync(join(output, `${index}-${variant}.log`), "w");
    const args = ["exec", "turbo", "run", "test", "--filter=@bb/app", "--force", "--continue", "--output-logs=full", "--summarize", "--concurrency=4", "--", "--reporter=json", `--outputFile="${report}"`];
    const started = performance.now();
    const result = spawnSync("pnpm", args, { shell: true, env: process.env, stdio: ["ignore", fd, fd] });
    const seconds = (performance.now() - started) / 1000;
    closeSync(fd);
    results.push({ variant, seconds, status: result.status, signal: result.signal, error: result.error?.message });
    writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.at(-1)));
    const summaries = readdirSync(".turbo/runs").filter((name) => name.endsWith(".json"));
    const latest = summaries.map((name) => ({name, start: JSON.parse(readFileSync(join(".turbo/runs", name), "utf8")).execution.startTime})).sort((a, b) => b.start - a.start)[0];
    if (latest) copyFileSync(join(".turbo/runs", latest.name), join(output, `${index}-${variant}-turbo.json`));
  }
} finally {
  writeFileSync(file, candidate);
}
if (results.some((result) => result.status !== 0)) process.exitCode = 1;
