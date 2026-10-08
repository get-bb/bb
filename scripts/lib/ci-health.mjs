export function distribution(values) {
  const sorted = values.toSorted((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, median: null, p90: null };
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
  };
}

const seconds = (start, end) => (Date.parse(end) - Date.parse(start)) / 1_000;

export function summarizeCiHealth(runs) {
  const outcomes = {};
  const durations = [];
  const runnerMinutes = [];
  const jobs = new Map();
  const failedSteps = new Map();
  const recoveries = [];
  for (const run of runs) {
    const outcome = run.conclusion ?? "pending";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    const first = run.jobs.filter(
      (job) => job.run_attempt === 1 && job.conclusion !== "skipped",
    );
    const timed =
      run.run_attempt === 1 && run.conclusion === "success" && first.length > 0;
    if (timed) {
      const last = first.reduce((a, b) =>
        a.completed_at > b.completed_at ? a : b,
      );
      durations.push(seconds(run.created_at, last.completed_at));
      runnerMinutes.push(
        first.reduce(
          (total, job) => total + seconds(job.started_at, job.completed_at),
          0,
        ) / 60,
      );
      for (const job of first) {
        if (!jobs.has(job.name))
          jobs.set(job.name, { durations: [], last: 0, restores: [] });
        const group = jobs.get(job.name);
        group.durations.push(seconds(job.started_at, job.completed_at));
        group.last += Number(job.id === last.id);
        for (const step of job.steps) {
          if (
            step.name === "Restore workspace caches" &&
            step.completed_at &&
            step.started_at
          )
            group.restores.push(seconds(step.started_at, step.completed_at));
        }
      }
    }
    const recovered = new Set();
    for (const job of run.jobs.filter((job) => job.conclusion === "failure")) {
      for (const step of job.steps.filter(
        (step) => step.conclusion === "failure",
      )) {
        if (!failedSteps.has(step.name)) failedSteps.set(step.name, new Set());
        failedSteps.get(step.name).add(run.id);
      }
      if (
        run.jobs.some(
          (later) =>
            later.name === job.name &&
            later.run_attempt > job.run_attempt &&
            later.conclusion === "success",
        )
      )
        recovered.add(job.name);
    }
    if (recovered.size)
      recoveries.push({ run: run.id, url: run.html_url, jobs: [...recovered] });
  }
  return {
    runs: runs.length,
    outcomes,
    rerunRuns: runs.filter((run) => run.run_attempt > 1).length,
    recoveredRuns: recoveries.length,
    durationSeconds: distribution(durations),
    runnerMinutes: distribution(runnerMinutes),
    jobs: [...jobs]
      .map(([name, group]) => ({
        name,
        ...distribution(group.durations),
        lastFinisher: group.last,
        cacheRestoreSeconds: distribution(group.restores),
      }))
      .sort((a, b) => b.lastFinisher - a.lastFinisher || b.median - a.median),
    failedSteps: [...failedSteps]
      .map(([name, ids]) => ({ name, runs: ids.size }))
      .sort((a, b) => b.runs - a.runs),
    recoveries,
  };
}

export async function collectCiHealth(api, since, until) {
  const runs = [];
  for (let page = 1; ; page++) {
    const data = await api(
      `actions/workflows/ci.yml/runs?created=${encodeURIComponent(`${since}..${until}`)}&per_page=100&page=${page}`,
    );
    if (
      !Array.isArray(data?.workflow_runs) ||
      !Number.isSafeInteger(data.total_count) ||
      data.total_count > 1_000
    )
      throw new Error(
        "Invalid or truncated CI run inventory; narrow the reporting window",
      );
    for (const run of data.workflow_runs) {
      if (
        !Number.isSafeInteger(run.id) ||
        !Number.isSafeInteger(run.run_attempt) ||
        run.run_attempt < 1 ||
        !Number.isFinite(Date.parse(run.created_at)) ||
        typeof run.html_url !== "string" ||
        !(run.conclusion === null || typeof run.conclusion === "string")
      )
        throw new Error("Invalid CI run");
      runs.push({
        id: run.id,
        run_attempt: run.run_attempt,
        created_at: run.created_at,
        conclusion: run.conclusion,
        html_url: run.html_url,
        jobs: [],
      });
    }
    if (data.workflow_runs.length < 100) break;
    if (page === 10)
      throw new Error("CI run inventory reached the API search limit");
  }
  for (let offset = 0; offset < runs.length; offset += 6) {
    await Promise.all(
      runs.slice(offset, offset + 6).map(async (run) => {
        if (run.conclusion === null) return;
        for (let page = 1; ; page++) {
          const data = await api(
            `actions/runs/${run.id}/jobs?filter=all&per_page=100&page=${page}`,
          );
          if (!Array.isArray(data?.jobs))
            throw new Error("Invalid CI job inventory");
          for (const job of data.jobs) {
            if (
              !Number.isSafeInteger(job.id) ||
              !Number.isSafeInteger(job.run_attempt) ||
              typeof job.name !== "string" ||
              !Array.isArray(job.steps) ||
              !(job.conclusion === null || typeof job.conclusion === "string")
            )
              throw new Error("Invalid CI job");
            for (const entry of [job, ...job.steps]) {
              if (
                typeof entry.name !== "string" ||
                !(
                  entry.conclusion === null ||
                  typeof entry.conclusion === "string"
                ) ||
                [entry.started_at, entry.completed_at].some(
                  (value) =>
                    value !== null && !Number.isFinite(Date.parse(value)),
                ) ||
                (entry.conclusion === "success" &&
                  (!entry.started_at || !entry.completed_at))
              )
                throw new Error("Invalid CI job or step timestamps");
            }
            run.jobs.push({
              id: job.id,
              name: job.name,
              run_attempt: job.run_attempt,
              conclusion: job.conclusion,
              started_at: job.started_at,
              completed_at: job.completed_at,
              steps: job.steps.map(
                ({ name, conclusion, started_at, completed_at }) => ({
                  name,
                  conclusion,
                  started_at,
                  completed_at,
                }),
              ),
            });
          }
          if (data.jobs.length < 100) break;
          if (page === 100)
            throw new Error("CI job inventory exceeded the report limit");
        }
      }),
    );
  }
  return runs;
}

export function ciHealthMarkdown(report) {
  const escape = (value) =>
    String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const number = (value) => (value === null ? "—" : value.toFixed(1));
  return [
    "# CI health",
    `Window: ${report.since} through ${report.until} (UTC).`,
    "",
    `${report.runs} runs; outcomes: ${JSON.stringify(report.outcomes)}.`,
    `${report.rerunRuns} runs retried; ${report.recoveredRuns} had a failed job pass in a later attempt on the same commit. Recovery includes infrastructure and external dependency failures; it is not a measured test-flake rate.`,
    "",
    `Successful first attempts: ${report.durationSeconds.count}; median ${number(report.durationSeconds.median)}s, p90 ${number(report.durationSeconds.p90)}s from run creation to the final job. Median summed job runtime: ${number(report.runnerMinutes.median)} runner-minutes.`,
    "Cancelled, failed, pending, and rerun workflows are excluded from timing distributions. Cache restore timings do not measure cache hit rates. Snapshot outcomes can change after this report.",
    "",
    "| Job | Samples | Median seconds | P90 seconds | Last finisher | Cache restore median seconds |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.jobs.map(
      (job) =>
        `| ${escape(job.name)} | ${job.count} | ${number(job.median)} | ${number(job.p90)} | ${job.lastFinisher} | ${number(job.cacheRestoreSeconds.median)} |`,
    ),
    "",
    "| Failed step | Distinct affected runs |",
    "|---|---:|",
    ...report.failedSteps.map(
      (step) => `| ${escape(step.name)} | ${step.runs} |`,
    ),
    "",
    ...report.recoveries.map(
      (recovery) =>
        `- [Run ${recovery.run}](${recovery.url}): ${recovery.jobs.map(escape).join(", ")}`,
    ),
    "",
  ].join("\n");
}
