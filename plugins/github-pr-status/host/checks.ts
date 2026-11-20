import { latestChecks } from "../assemble.js";
import type { CheckLog, GitHubPullRequestCheck } from "../contract.js";
import {
  describeGhActionFailure,
  GhCommandError,
  getPullRequestByUrl,
  runGh,
} from "./git-host.js";

const GH_LOG_TIMEOUT_MS = 45_000;
const GH_LOG_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const GH_RERUN_TIMEOUT_MS = 30_000;
const GH_RERUN_MAX_BUFFER_BYTES = 1024 * 1024;
const LOG_LINE_MAX_CHARS = 400;
const ALLOW_ESCAPE_SEQUENCES_FLAG = "--allow-escape-sequences";

const FAILED_CONCLUSIONS: ReadonlySet<GitHubPullRequestCheck["conclusion"]> =
  new Set([
    "failure",
    "cancelled",
    "timed_out",
    "action_required",
    "startup_failure",
    "stale",
  ]);

type ActionsJob = {
  host: string;
  repository: string;
  runId: string;
  jobId: string;
};

export function parseActionsJobUrl(url: string | null): ActionsJob | null {
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match =
    /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/job(?:s)?\/(\d+)/u.exec(
      parsed.pathname,
    );
  if (match === null) return null;
  return {
    host: parsed.hostname,
    repository: `${match[1]}/${match[2]}`,
    runId: match[3]!,
    jobId: match[4]!,
  };
}

export function tailCheckLog(log: string, lines: number): string {
  const all = log
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/u, "")
        .replace(/\u001b\[[0-9;]*[A-Za-z]/gu, ""),
    );
  let end = all.length;
  while (end > 0 && all[end - 1]!.trim() === "") end -= 1;
  for (let index = end - 1; index >= 0; index -= 1) {
    if (all[index]!.startsWith("##[error]")) {
      end = index + 1;
      break;
    }
  }
  return all
    .slice(Math.max(0, end - lines), end)
    .map((line) =>
      line.length > LOG_LINE_MAX_CHARS
        ? `${line.slice(0, LOG_LINE_MAX_CHARS)}...`
        : line,
    )
    .join("\n");
}

function isFailed(check: GitHubPullRequestCheck): boolean {
  return (
    check.status === "completed" && FAILED_CONCLUSIONS.has(check.conclusion)
  );
}

type PullRequestRepository = { host: string; repository: string };

type Selection =
  | {
      ok: true;
      checks: GitHubPullRequestCheck[];
      repository: PullRequestRepository;
    }
  | { ok: false; message: string };

function pullRequestRepository(url: string): PullRequestRepository {
  const parsed = new URL(url);
  const [owner = "", name = ""] = parsed.pathname.split("/").filter(Boolean);
  return { host: parsed.hostname, repository: `${owner}/${name}` };
}

function pullRequestJob(
  url: string | null,
  repository: PullRequestRepository,
): ActionsJob | null {
  const job = parseActionsJobUrl(url);
  return job !== null &&
    job.host === repository.host &&
    job.repository.toLowerCase() === repository.repository.toLowerCase()
    ? job
    : null;
}

async function selectChecks(
  cwd: string,
  url: string,
  check: string | null,
): Promise<Selection> {
  const lookup = await getPullRequestByUrl(url, cwd);
  if (lookup.outcome === "unavailable")
    return { ok: false, message: lookup.message };
  if (lookup.outcome === "none")
    return { ok: false, message: "No pull request found" };
  const checks = latestChecks(lookup.pullRequest.checks);
  const repository = pullRequestRepository(lookup.pullRequest.url);
  if (check === null) {
    const failed = checks.filter(isFailed);
    return failed.length > 0
      ? { ok: true, checks: failed, repository }
      : { ok: false, message: "No check has failed" };
  }
  const named = checks.filter((candidate) => candidate.name === check);
  if (named.length > 0) return { ok: true, checks: named, repository };
  const names = [...new Set(checks.map((candidate) => candidate.name))];
  return {
    ok: false,
    message:
      names.length === 0
        ? `No check named ${check}: the pull request has no checks`
        : `No check named ${check}. Checks: ${names.join(", ")}`,
  };
}

async function readJobLog(
  cwd: string,
  job: ActionsJob,
  lines: number,
): Promise<{ log: string | null; note: string | null }> {
  let args = [
    "api",
    "--hostname",
    job.host,
    `repos/${job.repository}/actions/jobs/${job.jobId}/logs`,
  ];
  const read = () =>
    runGh(args, {
      cwd,
      priority: "interactive",
      timeoutMs: GH_LOG_TIMEOUT_MS,
      maxBuffer: GH_LOG_MAX_BUFFER_BYTES,
    });
  try {
    let stdout: string;
    try {
      ({ stdout } = await read());
    } catch (error) {
      if (
        !(error instanceof GhCommandError) ||
        !error.stderr.includes(ALLOW_ESCAPE_SEQUENCES_FLAG)
      )
        throw error;
      args = [
        ...args.slice(0, 1),
        ALLOW_ESCAPE_SEQUENCES_FLAG,
        ...args.slice(1),
      ];
      ({ stdout } = await read());
    }
    return { log: tailCheckLog(stdout, lines), note: null };
  } catch (error) {
    if (error instanceof GhCommandError && error.reason === "missing")
      throw error;
    return { log: null, note: describeGhActionFailure(args, error) };
  }
}

export async function readCheckLogs(args: {
  cwd: string;
  url: string;
  check: string | null;
  lines: number;
}): Promise<{ ok: true; checks: CheckLog[] } | { ok: false; message: string }> {
  const selection = await selectChecks(args.cwd, args.url, args.check);
  if (!selection.ok) return selection;
  try {
    const checks = await Promise.all(
      selection.checks.map(async (check): Promise<CheckLog> => {
        const job = pullRequestJob(check.url, selection.repository);
        if (job === null)
          return {
            name: check.name,
            url: check.url,
            log: null,
            note: "Not a GitHub Actions job of this pull request's repository, so its log can't be read here. Open its link.",
          };
        return {
          name: check.name,
          url: check.url,
          ...(await readJobLog(args.cwd, job, args.lines)),
        };
      }),
    );
    return { ok: true, checks };
  } catch (error) {
    return { ok: false, message: describeGhActionFailure(["api"], error) };
  }
}

export async function rerunChecks(args: {
  cwd: string;
  url: string;
  check: string | null;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const selection = await selectChecks(args.cwd, args.url, args.check);
  if (!selection.ok) return selection;
  const runs = new Map<string, ActionsJob>();
  const jobs = new Map<string, ActionsJob>();
  const skipped: string[] = [];
  for (const check of selection.checks) {
    const job = pullRequestJob(check.url, selection.repository);
    if (job === null) skipped.push(check.name);
    else if (args.check === null) runs.set(`${job.host}/${job.runId}`, job);
    else jobs.set(`${job.host}/${job.jobId}`, job);
  }
  const commands = [
    ...[...runs.values()].map((job) => [
      "run",
      "rerun",
      job.runId,
      "--failed",
      "-R",
      `${job.host}/${job.repository}`,
    ]),
    ...[...jobs.values()].map((job) => [
      "run",
      "rerun",
      "--job",
      job.jobId,
      "-R",
      `${job.host}/${job.repository}`,
    ]),
  ];
  if (commands.length === 0)
    return {
      ok: false,
      message: `None of these checks is a GitHub Actions job of this pull request's repository, so bb can't re-run them: ${skipped.join(", ")}`,
    };
  const failures: string[] = [];
  for (const command of commands) {
    try {
      await runGh(command, {
        cwd: args.cwd,
        priority: "interactive",
        timeoutMs: GH_RERUN_TIMEOUT_MS,
        maxBuffer: GH_RERUN_MAX_BUFFER_BYTES,
      });
    } catch (error) {
      failures.push(describeGhActionFailure(command, error));
    }
  }
  if (failures.length === commands.length)
    return { ok: false, message: failures.join("\n") };
  const started =
    args.check === null
      ? `Re-running the failed jobs of ${commands.length - failures.length} workflow run(s)`
      : `Re-running ${args.check}`;
  return {
    ok: true,
    message: [
      started,
      ...failures,
      ...(skipped.length > 0
        ? [
            `Not GitHub Actions jobs of this repository, not re-run: ${skipped.join(", ")}`,
          ]
        : []),
    ].join("\n"),
  };
}
