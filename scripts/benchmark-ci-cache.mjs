import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

mkdirSync(".cache-benchmark", { recursive: true });
const arms = process.env.BENCH_ORDER === "old-first" ? ["old", "new"] : ["new", "old"];
const results = [];
for (const arm of arms) {
  for (const shard of [1, 2]) {
    const prior = new Set(readdirSync(".turbo/runs", { throwIfNoEntry: false }) ?? []);
    const args = ["exec", "turbo", "run", "test", "--filter=@bb/server", `--cache-dir=.turbo/benchmark-${arm}`, "--cache=local:rw", "--output-logs=errors-only", "--summarize", "--concurrency=4"];
    if (arm === "old") args.push("--", `--shard=${shard}/3`);
    const started = performance.now();
    const result = spawnSync("pnpm", args, {
      shell: process.platform === "win32",
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
      env: { ...process.env, BB_CI_TEST_SHARD: arm === "new" ? `${shard}/3` : "" },
    });
    const wallSeconds = (performance.now() - started) / 1000;
    const label = `${arm}-${shard}`;
    writeFileSync(`.cache-benchmark/${label}.log`, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    const summaryFile = readdirSync(".turbo/runs").find(name => !prior.has(name) && name.endsWith(".json"));
    if (!summaryFile) throw new Error(`No summary for ${label}: ${result.error ?? result.status}`);
    const summary = JSON.parse(readFileSync(join(".turbo/runs", summaryFile), "utf8"));
    copyFileSync(join(".turbo/runs", summaryFile), `.cache-benchmark/${label}.json`);
    const record = { arm, shard, wallSeconds, exitCode: result.status, tasks: summary.tasks.map(task => ({ taskId: task.taskId, hash: task.hash, cache: task.cache.status, cliArguments: task.cliArguments, seconds: task.execution ? (task.execution.endTime - task.execution.startTime) / 1000 : 0 })) };
    results.push(record);
    console.log(JSON.stringify(record));
    writeFileSync(".cache-benchmark/results.json", JSON.stringify(results, null, 2));
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
