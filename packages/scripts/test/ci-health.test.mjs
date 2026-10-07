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
      job(1, "plan", 1, "success", 10, 20),
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
  });
  expect(report.recoveries[0].jobs).toEqual(["Windows", "Linux"]);
  expect(report.outcomes).toEqual({
    success: 2,
    failure: 1,
    cancelled: 1,
    pending: 1,
  });
  expect(
    ciHealthMarkdown({ since: time(0), until: time(3_600), ...report }),
  ).toContain("not a measured test-flake rate");
});

it("handles an empty window without inventing timings", () => {
  const report = summarizeCiHealth([]);
  expect(report.durationSeconds).toEqual({ count: 0, median: null, p90: null });
  expect(report.jobs).toEqual([]);
  expect(
    ciHealthMarkdown({ since: time(0), until: time(3_600), ...report }),
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
  );
  expect(calls[1]).toContain("filter=all");
  expect(summarizeCiHealth(runs).recoveredRuns).toBe(1);
  for (const data of [
    { total_count: 1_001, workflow_runs: [] },
    { total_count: 1, workflow_runs: [{ id: "wrong" }] },
  ]) {
    await expect(
      collectCiHealth(async () => data, time(0), time(3_600)),
    ).rejects.toThrow();
  }
});
