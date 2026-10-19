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
      job(2, "Windows", 1, "success", 30, 150, [
        {
          ...failure,
          conclusion: "success",
          started_at: time(30),
          completed_at: time(80),
        },
        {
          name: "Test",
          conclusion: "success",
          started_at: time(80),
          completed_at: time(145),
        },
        {
          name: "Optional setup",
          conclusion: "skipped",
          started_at: time(30),
          completed_at: time(30),
        },
      ]),
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
  expect(report.eventualGreenSeconds).toEqual({
    count: 2,
    median: 600,
    p90: 1_050,
  });
  expect(report.runnerMinutes.median).toBe(3.5);
  expect(report.rerunRuns).toBe(2);
  expect(report.recoveredRuns).toBe(1);
  expect(report.firstAttemptOutcomes).toEqual({
    success: 1,
    failure: 2,
    cancelled: 1,
    unavailable: 1,
  });
  expect(report.failureGroups).toEqual([
    { job: "Windows", step: "Install dependencies", runs: 2, recoveredRuns: 1 },
    { job: "Linux", step: "Install dependencies", runs: 1, recoveredRuns: 1 },
  ]);
  expect(report.failedSteps).toEqual([
    { name: "Install dependencies", runs: 2 },
  ]);
  expect(report.jobs[0]).toMatchObject({
    name: "Windows",
    lastFinisher: 1,
    median: 120,
    startDelaySeconds: { count: 1, median: 10, p90: 10 },
    steps: [
      {
        name: "Install dependencies",
        durationSeconds: { count: 1, median: 50, p90: 50 },
      },
      { name: "Test", durationSeconds: { count: 1, median: 65, p90: 65 } },
    ],
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

it("fetches all job attempts and marks truncated or malformed inventory incomplete", async () => {
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
      firstAttemptOutcomes: {},
      durationSeconds: { count: 0, median: null, p90: null },
    },
    {
      event: "push",
      runs: 1,
      firstAttemptOutcomes: { success: 1 },
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

it("keeps cohort identity stable across job ordering while separating triggers and selected work", () => {
  const jobs = [
    job(1, "Windows", 1, "success", 10, 100),
    job(2, "Linux", 1, "success", 10, 80),
  ];
  const report = summarizeCiHealth([
    run(1, 1, "success", jobs),
    run(2, 1, "success", [...jobs].reverse()),
    { ...run(3, 1, "success", jobs), event: "push" },
    run(4, 1, "success", [jobs[0], job(3, "Linux", 1, "skipped", 0, 0)]),
  ]);
  expect(report.cohorts).toHaveLength(3);
  expect(report.cohorts[0]).toMatchObject({
    event: "pull_request",
    jobs: ["Linux", "Windows"],
    runs: 2,
    durationSeconds: { count: 2, median: 100, p90: 100 },
  });
  expect(new Set(report.cohorts.map((cohort) => cohort.id)).size).toBe(3);
  expect(
    summarizeCiHealth([run(5, 1, "success", [...jobs].reverse())]).cohorts[0]
      .id,
  ).toBe(report.cohorts[0].id);
});

it("collects bounded failure annotations without losing timing evidence when annotations fail", async () => {
  const evidence = await collectCiHealth(
    async (path) => {
      if (path.startsWith("actions/workflows/"))
        return { total_count: 1, workflow_runs: [run(1, 3, "success", [])] };
      if (path.startsWith("actions/runs/"))
        return {
          jobs: [
            {
              ...job(1, "Windows", 1, "failure", 0, 10),
              check_run_url:
                "https://api.github.com/repos/get-bb/bb/check-runs/11",
            },
            {
              ...job(2, "Windows", 2, "failure", 20, 30),
              check_run_url:
                "https://api.github.com/repos/get-bb/bb/check-runs/12",
            },
            {
              ...job(3, "Linux", 1, "failure", 0, 10),
              check_run_url:
                "https://api.github.com/repos/get-bb/bb/check-runs/13",
            },
            job(4, "Windows", 3, "success", 50, 60),
            job(5, "Linux", 3, "success", 50, 60),
          ],
        };
      if (path.startsWith("check-runs/13/"))
        throw new Error("permission denied");
      return Array.from({ length: 100 }, (_, index) => ({
        title: "Test timeout",
        message: `Exceeded ${path.startsWith("check-runs/11/") ? 5000 : 6000} ms`,
        annotation_level: index === 99 ? "warning" : "failure",
      }));
    },
    time(0),
    time(3_600),
    () => {},
  );
  expect(evidence.errors).toEqual([]);
  expect(evidence.runs[0].jobsComplete).toBe(true);
  expect(evidence.annotations).toEqual({
    eligibleJobs: 3,
    fetchedJobs: 2,
    truncatedJobs: 2,
    unavailableJobs: 1,
    errors: [{ scope: "job 3", message: "permission denied" }],
  });
  const report = summarizeCiHealth(evidence.runs);
  expect(report.eventualGreenSeconds).toEqual({
    count: 1,
    median: 60,
    p90: 60,
  });
  expect(report.failureSignatures).toEqual([
    {
      job: "Windows",
      signature: "Test timeout: Exceeded <n> ms",
      runs: 1,
      url: "https://github.com/get-bb/bb/actions/runs/1",
    },
  ]);
});
