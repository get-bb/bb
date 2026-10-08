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
  const events = new Map();
  for (const run of runs) {
    const outcome = run.conclusion ?? "pending";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    if (!events.has(run.event))
      events.set(run.event, { runs: 0, durations: [] });
    const event = events.get(run.event);
    event.runs++;
    const first = run.jobs.filter(
      (job) => job.run_attempt === 1 && job.conclusion !== "skipped",
    );
    if (!run.jobsComplete) continue;
    const timed =
      run.run_attempt === 1 && run.conclusion === "success" && first.length > 0;
    if (timed) {
      const last = first.reduce((a, b) =>
        a.completed_at > b.completed_at ? a : b,
      );
      const duration = seconds(run.created_at, last.completed_at);
      durations.push(duration);
      event.durations.push(duration);
      runnerMinutes.push(
        first.reduce(
          (total, job) => total + seconds(job.started_at, job.completed_at),
          0,
        ) / 60,
      );
      for (const job of first) {
        if (!jobs.has(job.name))
          jobs.set(job.name, {
            durations: [],
            last: 0,
            restores: [],
            startDelays: [],
          });
        const group = jobs.get(job.name);
        group.durations.push(seconds(job.started_at, job.completed_at));
        group.last += Number(job.id === last.id);
        const plan = first.find((entry) => entry.name === "Select CI checks");
        const ready =
          !plan ||
          job.id === plan.id ||
          job.name.startsWith("Node Compatibility Smoke")
            ? run.created_at
            : plan.completed_at;
        group.startDelays.push(Math.max(0, seconds(ready, job.started_at)));
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
    incompleteRuns: runs.filter(
      (run) => !run.jobsComplete && run.conclusion !== null,
    ).length,
    events: [...events].map(([event, group]) => ({
      event,
      runs: group.runs,
      durationSeconds: distribution(group.durations),
    })),
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
        startDelaySeconds: distribution(group.startDelays),
      }))
      .sort((a, b) => b.lastFinisher - a.lastFinisher || b.median - a.median),
    failedSteps: [...failedSteps]
      .map(([name, ids]) => ({ name, runs: ids.size }))
      .sort((a, b) => b.runs - a.runs),
    recoveries,
  };
}

export async function collectCiHealth(api, since, until, checkpoint) {
  const runs = [];
  const errors = [];
  const evidence = { runs, errors, inventoryComplete: false };
  try {
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
          typeof run.event !== "string" ||
          !(run.conclusion === null || typeof run.conclusion === "string")
        )
          throw new Error("Invalid CI run");
        runs.push({
          id: run.id,
          run_attempt: run.run_attempt,
          created_at: run.created_at,
          conclusion: run.conclusion,
          html_url: run.html_url,
          event: run.event,
          jobsComplete: false,
          jobs: [],
        });
      }
      await checkpoint(evidence);
      if (data.workflow_runs.length < 100) break;
      if (page === 10)
        throw new Error("CI run inventory reached the API search limit");
    }
    evidence.inventoryComplete = true;
  } catch (error) {
    errors.push({
      scope: "run inventory",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  await checkpoint(evidence);
  for (let offset = 0; offset < runs.length; offset += 6) {
    await Promise.all(
      runs.slice(offset, offset + 6).map(async (run) => {
        if (run.conclusion === null) return;
        try {
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
          run.jobsComplete = true;
        } catch (error) {
          errors.push({
            scope: `run ${run.id}`,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
    await checkpoint(evidence);
  }
  return evidence;
}

export function ciHealthMarkdown(report) {
  const escape = (value) =>
    String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const number = (value) => (value === null ? "—" : value.toFixed(1));
  return [
    "# CI health",
    `Window: ${report.since} through ${report.until} (UTC).`,
    "",
    ...(report.collection.inventoryComplete &&
    report.collection.errors.length === 0 &&
    report.incompleteRuns === 0
      ? ["Collection complete."]
      : [
          "**INCOMPLETE COLLECTION: counts and distributions cover only the available evidence.**",
          ...report.collection.errors.map(
            (error) => `- ${escape(error.scope)}: ${escape(error.message)}`,
          ),
        ]),
    `${report.incompleteRuns} completed runs lack a complete job inventory and are excluded from timing and recovery statistics.`,
    `${report.runs} runs; outcomes: ${JSON.stringify(report.outcomes)}.`,
    `${report.rerunRuns} runs retried; ${report.recoveredRuns} had a failed job pass in a later attempt on the same commit. Recovery includes infrastructure and external dependency failures; it is not a measured test-flake rate.`,
    "",
    `Successful first attempts: ${report.durationSeconds.count}; median ${number(report.durationSeconds.median)}s, p90 ${number(report.durationSeconds.p90)}s from run creation to the final job. Median summed job runtime: ${number(report.runnerMinutes.median)} runner-minutes.`,
    "Cancelled, failed, pending, and rerun workflows are excluded from timing distributions. Cache restore timings do not measure cache hit rates. Snapshot outcomes can change after this report.",
    "",
    "| Trigger | Runs | Timed samples | Median seconds | P90 seconds |",
    "|---|---:|---:|---:|---:|",
    ...report.events.map(
      (group) =>
        `| ${escape(group.event)} | ${group.runs} | ${group.durationSeconds.count} | ${number(group.durationSeconds.median)} | ${number(group.durationSeconds.p90)} |`,
    ),
    "",
    "Start delay is measured from planning completion for dependent jobs and from run creation for planning and Node compatibility. It includes Actions scheduling and runner provisioning, not just a runner queue.",
    "",
    "| Job | Samples | Median seconds | P90 seconds | Last finisher | Cache restore median seconds | Start delay median seconds | Start delay p90 seconds |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...report.jobs.map(
      (job) =>
        `| ${escape(job.name)} | ${job.count} | ${number(job.median)} | ${number(job.p90)} | ${job.lastFinisher} | ${number(job.cacheRestoreSeconds.median)} | ${number(job.startDelaySeconds.median)} | ${number(job.startDelaySeconds.p90)} |`,
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
