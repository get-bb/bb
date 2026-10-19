import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const label = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/[\x00-\x1f\x7f]/u.test(value);
const duration = (execution) => {
  if (!object(execution)) return null;
  const { startTime, endTime } = execution;
  return Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    startTime >= 0 &&
    endTime >= startTime
    ? endTime - startTime
    : null;
};
const markdownCell = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;");
const report = {
  version: 1,
  job: {
    runId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    name: process.env.GITHUB_JOB ?? null,
    runnerOs: process.env.RUNNER_OS ?? null,
  },
  summaries: 0,
  duplicateSummaries: 0,
  invalidSummaries: 0,
  invalidTasks: 0,
  tasks: [],
};
const runs = new Set();
const groups = new Map();
let files;
try {
  files = readdirSync(".turbo/runs")
    .filter((file) => file.endsWith(".json"))
    .sort();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  files = [];
}
for (const file of files) {
  let run;
  try {
    const path = join(".turbo/runs", file);
    if (statSync(path).size > 32 * 1024 * 1024)
      throw new Error("Summary too large");
    run = JSON.parse(readFileSync(path, "utf8"));
    if (
      !object(run) ||
      !label(run.id) ||
      !Array.isArray(run.tasks) ||
      !object(run.execution)
    )
      throw new Error("Invalid run summary");
  } catch {
    report.invalidSummaries++;
    continue;
  }
  if (runs.has(run.id)) {
    report.duplicateSummaries++;
    continue;
  }
  runs.add(run.id);
  report.summaries++;
  const seenTasks = new Set();
  for (const task of run.tasks) {
    if (!object(task) || !label(task.taskId) || !label(task.hash)) {
      report.invalidTasks++;
      continue;
    }
    const key = JSON.stringify([task.taskId, task.hash]);
    if (seenTasks.has(key)) continue;
    seenTasks.add(key);
    let group = groups.get(key);
    if (!group) {
      group = {
        taskId: task.taskId,
        hash: task.hash,
        invocations: 0,
        hits: 0,
        misses: 0,
        unknown: 0,
        timedInvocations: 0,
        durationMs: 0,
        executedMisses: 0,
        missDurationMs: 0,
        repeatedMisses: 0,
      };
      groups.set(key, group);
    }
    group.invocations++;
    const status = object(task.cache) ? task.cache.status : null;
    if (status === "HIT") group.hits++;
    else if (status === "MISS") group.misses++;
    else group.unknown++;
    const elapsed = duration(task.execution);
    if (elapsed !== null) {
      group.timedInvocations++;
      group.durationMs += elapsed;
      if (status === "MISS") {
        group.executedMisses++;
        group.missDurationMs += elapsed;
      }
    }
    group.repeatedMisses = Math.max(0, group.executedMisses - 1);
  }
}
report.tasks = [...groups.values()].sort(
  (a, b) =>
    b.missDurationMs - a.missDurationMs ||
    a.taskId.localeCompare(b.taskId) ||
    a.hash.localeCompare(b.hash),
);
const total = (field) =>
  report.tasks.reduce((sum, task) => sum + task[field], 0);
report.totals = Object.fromEntries(
  [
    "invocations",
    "hits",
    "misses",
    "unknown",
    "timedInvocations",
    "durationMs",
    "executedMisses",
    "missDurationMs",
    "repeatedMisses",
  ].map((field) => [field, total(field)]),
);
const markdown = [
  "## Turbo task cache and timing",
  "",
  `${report.summaries} run summaries; ${total("hits")} cache hits, ${total("misses")} misses, ${total("unknown")} unknown statuses.`,
  `${total("repeatedMisses")} repeated executions of the same task/hash after a cache miss.`,
  `Skipped ${report.duplicateSummaries} duplicate summaries, ${report.invalidSummaries} invalid summaries and ${report.invalidTasks} invalid tasks.`,
  "",
  "Durations sum task intervals, including cache replay, and are not job wall time. Missing intervals are excluded. Repeated misses are candidates for investigation; intentionally uncached tasks also appear. Only explicit Turbo HIT/MISS statuses count. Repeated invocations in distinct runs remain counted; copied summaries and duplicate entries within a run do not.",
  "",
  "Top 30 task/hash groups by cache-miss duration:",
  "",
  "| Task | Hash | Hits | Misses | Unknown | Timed / total | Miss seconds | Repeated misses |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...report.tasks
    .slice(0, 30)
    .map(
      (task) =>
        `| ${markdownCell(task.taskId)} | ${markdownCell(task.hash)} | ${task.hits} | ${task.misses} | ${task.unknown} | ${task.timedInvocations} / ${task.invocations} | ${(task.missDurationMs / 1000).toFixed(2)} | ${task.repeatedMisses} |`,
    ),
  "",
].join("\n");
mkdirSync(".ci-task-timings", { recursive: true });
writeFileSync(
  ".ci-task-timings/report.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(".ci-task-timings/report.md", markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(
  `Turbo task timing report: ${report.summaries} summaries, ${report.tasks.length} task/hash groups, ${report.invalidSummaries} invalid summaries.`,
);
