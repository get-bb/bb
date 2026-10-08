import { expect, it } from "vitest";
import {
  ciHealthMarkdown,
  collectCiHealth,
  summarizeCiHealth,
} from "../../../scripts/lib/ci-health.mjs";

const time = (seconds) =>
  new Date(Date.UTC(2026, 9, 7, 0, 0, seconds)).toISOString();
const job = (id, name, attempt, conclusion, start, end, steps = []) => ({
  id,
  name,
  run_attempt: attempt,
  conclusion,
  started_at: time(start),
  completed_at: time(end),
  steps,
});
const run = (id, attempt, conclusion, jobs) => ({
  id,
  run_attempt: attempt,
  conclusion,
  created_at: time(0),
  event: "pull_request",
  jobsComplete: true,
  html_url: `https://github.com/get-bb/bb/actions/runs/${id}`,
  jobs,
});

it("separates first-attempt latency from retries and counts failure incidents by run", () => {
  const failure = {
    name: "Install dependencies",
    conclusion: "failure",
    started_at: time(10),
    completed_at: time(20),
  };
  const report = summarizeCiHealth([
    run(1, 1, "success", [
      job(1, "Select CI checks", 1, "success", 10, 20),
      job(2, "Windows", 1, "success", 30, 150),
      job(3, "Linux", 1, "success", 20, 100),
    ]),
    run(2, 2, "success", [
      job(4, "Windows", 1, "failure", 10, 20, [failure]),
      job(5, "Linux", 1, "failure", 10, 20, [failure]),
      job(6, "Windows", 2, "success", 1_000, 1_050),
      job(7, "Linux", 2, "success", 1_000, 1_020),
    ]),
    run(3, 2, "failure", [
      job(8, "Windows", 1, "failure", 10, 20, [failure]),
      job(9, "Windows", 2, "failure", 100, 120, [failure]),
    ]),
    run(4, 1, "cancelled", [job(10, "Windows", 1, "cancelled", 10, 30)]),
    run(5, 1, null, []),
  ]);
  expect(report.durationSeconds).toEqual({ count: 1, median: 150, p90: 150 });
  expect(report.runnerMinutes.median).toBe(3.5);
  expect(report.rerunRuns).toBe(2);
  expect(report.recoveredRuns).toBe(1);
  expect(report.failedSteps).toEqual([
    { name: "Install dependencies", runs: 2 },
  ]);
  expect(report.jobs[0]).toMatchObject({
    name: "Windows",
    lastFinisher: 1,
    median: 120,
    startDelaySeconds: { count: 1, median: 10, p90: 10 },
  });
  expect(report.recoveries[0].jobs).toEqual(["Windows", "Linux"]);
  expect(report.outcomes).toEqual({
    success: 2,
    failure: 1,
    cancelled: 1,
    pending: 1,
  });
  expect(
    ciHealthMarkdown({
      since: time(0),
      until: time(3_600),
      collection: { inventoryComplete: true, errors: [] },
      ...report,
    }),
  ).toContain("not a measured test-flake rate");
});

it("handles an empty window without inventing timings", () => {
  const report = summarizeCiHealth([]);
  expect(report.durationSeconds).toEqual({ count: 0, median: null, p90: null });
  expect(report.jobs).toEqual([]);
  expect(
    ciHealthMarkdown({
      since: time(0),
      until: time(3_600),
      collection: { inventoryComplete: true, errors: [] },
      ...report,
    }),
  ).toContain("median —s");
});

it("fetches all job attempts and rejects truncated or malformed API evidence", async () => {
  const calls = [];
  const runs = await collectCiHealth(
    async (path) => {
      calls.push(path);
      if (path.startsWith("actions/workflows/"))
        return { total_count: 1, workflow_runs: [run(1, 2, "success", [])] };
      return {
        jobs: [
          job(1, "test", 1, "failure", 0, 10),
          job(2, "test", 2, "success", 20, 30),
        ],
      };
    },
    time(0),
    time(3_600),
    () => {},
  );
  expect(calls[1]).toContain("filter=all");
  expect(summarizeCiHealth(runs.runs).recoveredRuns).toBe(1);
  for (const data of [
    { total_count: 1_001, workflow_runs: [] },
    { total_count: 1, workflow_runs: [{ id: "wrong" }] },
  ]) {
    const evidence = await collectCiHealth(
      async () => data,
      time(0),
      time(3_600),
      () => {},
    );
    expect(evidence.inventoryComplete).toBe(false);
    expect(evidence.errors).toHaveLength(1);
  }
});

it("checkpoints incomplete evidence and excludes a partly fetched run without discarding other runs", async () => {
  const checkpoints = [];
  const evidence = await collectCiHealth(
    async (path) => {
      if (path.startsWith("actions/workflows/"))
        return {
          total_count: 2,
          workflow_runs: [
            run(1, 1, "success", []),
            { ...run(2, 1, "success", []), event: "push" },
          ],
        };
      if (path.includes("runs/2/"))
        return { jobs: [job(101, "build", 1, "success", 10, 50)] };
      if (path.endsWith("page=2")) throw new Error("upstream unavailable");
      return {
        jobs: Array.from({ length: 100 }, (_, index) =>
          job(index + 1, `test-${index}`, 1, "success", 10, 20),
        ),
      };
    },
    time(0),
    time(3_600),
    (snapshot) => checkpoints.push(structuredClone(snapshot)),
  );
  expect(checkpoints[0].runs).toHaveLength(2);
  expect(checkpoints.at(-1)).toEqual(evidence);
  expect(evidence.inventoryComplete).toBe(true);
  expect(evidence.errors).toEqual([
    { scope: "run 1", message: "upstream unavailable" },
  ]);
  expect(evidence.runs[0].jobs).toHaveLength(100);
  const report = summarizeCiHealth(evidence.runs);
  expect(report.incompleteRuns).toBe(1);
  expect(report.durationSeconds).toEqual({ count: 1, median: 50, p90: 50 });
  expect(report.events).toEqual([
    {
      event: "pull_request",
      runs: 1,
      durationSeconds: { count: 0, median: null, p90: null },
    },
    {
      event: "push",
      runs: 1,
      durationSeconds: { count: 1, median: 50, p90: 50 },
    },
  ]);
  expect(
    ciHealthMarkdown({
      since: time(0),
      until: time(3_600),
      collection: evidence,
      ...report,
    }),
  ).toContain("INCOMPLETE COLLECTION");
});
