import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../../scripts/report-ci-task-timings.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "ci-task-timings-"));
  roots.push(root);
  return root;
}
function run(root) {
  const summary = join(root, "summary.md");
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
  });
  expect(result.status, result.stderr).toBe(0);
  return {
    report: JSON.parse(
      readFileSync(join(root, ".ci-task-timings/report.json"), "utf8"),
    ),
    markdown: readFileSync(summary, "utf8"),
    stdout: result.stdout,
  };
}
it("counts actual cache outcomes across runs without duplicating copied summaries or exposing run inputs", () => {
  const root = workspace();
  mkdirSync(join(root, ".turbo/runs"), { recursive: true });
  const task = {
    taskId: "@bb/app#build",
    hash: "abc",
    cache: { status: "MISS" },
    execution: { startTime: 1000, endTime: 4000 },
  };
  const first = {
    id: "run-1",
    execution: {},
    tasks: [task, task],
    globalCacheInputs: { secret: "do-not-publish" },
  };
  const second = {
    id: "run-2",
    execution: {},
    tasks: [
      task,
      { ...task, taskId: "cached", cache: { status: "HIT" } },
      { ...task, taskId: "unknown", cache: { local: true } },
      {
        ...task,
        taskId: "untimed",
        execution: { startTime: 4000, endTime: 1000 },
      },
      { ...task, taskId: "unstarted", execution: undefined },
    ],
  };
  for (const [name, value] of Object.entries({ first, copy: first, second }))
    writeFileSync(
      join(root, `.turbo/runs/${name}.json`),
      JSON.stringify(value),
    );
  const { report, markdown, stdout } = run(root);
  expect(report.summaries).toBe(2);
  expect(report.duplicateSummaries).toBe(1);
  expect(report.totals).toEqual({
    invocations: 6,
    hits: 1,
    misses: 4,
    unknown: 1,
    timedInvocations: 4,
    durationMs: 12000,
    executedMisses: 2,
    missDurationMs: 6000,
    repeatedMisses: 1,
  });
  expect(
    report.tasks.find((entry) => entry.taskId === task.taskId),
  ).toMatchObject({
    invocations: 2,
    misses: 2,
    missDurationMs: 6000,
    repeatedMisses: 1,
  });
  expect(markdown).toContain("1 cache hits, 4 misses, 1 unknown");
  expect(JSON.stringify(report) + markdown + stdout).not.toContain(
    "do-not-publish",
  );
});
it("writes a usable report when no tasks ran and skips malformed or dry-run summaries", () => {
  const root = workspace();
  expect(run(root).report.totals.invocations).toBe(0);
  mkdirSync(join(root, ".turbo/runs"), { recursive: true });
  writeFileSync(join(root, ".turbo/runs/broken.json"), "private-invalid-json");
  writeFileSync(
    join(root, ".turbo/runs/dry.json"),
    JSON.stringify({ id: "dry", tasks: [] }),
  );
  writeFileSync(
    join(root, ".turbo/runs/partial.json"),
    JSON.stringify({
      id: "partial",
      execution: {},
      tasks: [
        null,
        { taskId: "missing-hash" },
        { taskId: "<script>|build", hash: "abc", cache: { status: "FUTURE" } },
      ],
    }),
  );
  const { report, markdown, stdout } = run(root);
  expect(report).toMatchObject({
    summaries: 1,
    invalidSummaries: 2,
    invalidTasks: 2,
    totals: { invocations: 1, unknown: 1, timedInvocations: 0 },
  });
  expect(markdown).toContain("&lt;script&gt;&#124;build");
  expect(stdout + markdown).not.toContain("private-invalid-json");
});
