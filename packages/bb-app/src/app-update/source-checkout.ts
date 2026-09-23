import { z } from "zod";
import type {
  AppUpdateBlockReason,
  SourceAppRevision,
  SourceUpdateCheck,
} from "@bb/config/app-update";
import { runCheckedCommand, type RunCommand } from "./run-command.js";

const SOURCE_BRANCH = "main";
const SOURCE_REMOTE = "origin";
const UPSTREAM_REF = `${SOURCE_REMOTE}/${SOURCE_BRANCH}`;
const FETCH_TIMEOUT_MS = 2 * 60 * 1000;
const INCOMING_SUBJECT_LIMIT = 20;
const BB_APP_PACKAGE_JSON_PATH = "packages/bb-app/package.json";
export const SOURCE_MIGRATION_JOURNAL_PATH =
  "packages/db/drizzle/meta/_journal.json";

const packageJsonSchema = z
  .object({ version: z.string().min(1) })
  .passthrough();

interface SourceGitArgs {
  repoRoot: string;
  runner: RunCommand;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function git(
  args: SourceGitArgs,
  gitArgs: string[],
  timeoutMs?: number,
): Promise<string> {
  const result = await runCheckedCommand(
    args.runner,
    `git ${gitArgs[0] ?? ""}`,
    {
      args: gitArgs,
      command: "git",
      cwd: args.repoRoot,
      env: gitEnv(),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  );
  return result.stdout.trim();
}

async function tryGit(
  args: SourceGitArgs,
  gitArgs: string[],
): Promise<string | null> {
  const result = await args.runner({
    args: gitArgs,
    command: "git",
    cwd: args.repoRoot,
    env: gitEnv(),
  });
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function readSourceFileAt(
  args: SourceGitArgs & { commit: string; path: string },
): Promise<string | null> {
  return tryGit(args, ["show", `${args.commit}:${args.path}`]);
}

async function readVersionAt(
  args: SourceGitArgs & { commit: string },
): Promise<string> {
  const raw = await readSourceFileAt({
    ...args,
    path: BB_APP_PACKAGE_JSON_PATH,
  });
  if (raw === null) return "unknown";
  try {
    const parsed = packageJsonSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.version : "unknown";
  } catch {
    return "unknown";
  }
}

export async function readSourceRevision(
  args: SourceGitArgs,
): Promise<SourceAppRevision> {
  const commit = await git(args, ["rev-parse", "HEAD"]);
  return {
    commit,
    kind: "source",
    version: await readVersionAt({ ...args, commit }),
  };
}

function blocked(reason: AppUpdateBlockReason, message: string) {
  return { message, reason };
}

async function readLocalBlock(
  args: SourceGitArgs,
): Promise<SourceUpdateCheck["blocked"]> {
  const branch = await tryGit(args, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  if (branch === null) {
    return blocked(
      "detached-head",
      `The checkout is on a detached HEAD. Check out ${SOURCE_BRANCH} to update from the app.`,
    );
  }
  if (branch !== SOURCE_BRANCH) {
    return blocked(
      "not-on-main",
      `The checkout is on ${branch}. Only ${SOURCE_BRANCH} can be updated from the app.`,
    );
  }
  const status = await git(args, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  if (status !== "") {
    return blocked(
      "uncommitted-changes",
      "The working tree has uncommitted changes. Commit or stash them to update from the app.",
    );
  }
  return null;
}

export async function inspectSourceCheckout(
  args: SourceGitArgs & { fetch: boolean },
): Promise<SourceUpdateCheck> {
  const current = await readSourceRevision(args);
  const localBlock = await readLocalBlock(args);
  if (args.fetch && localBlock?.reason !== "detached-head") {
    const fetchResult = await args.runner({
      args: ["fetch", "--quiet", SOURCE_REMOTE, SOURCE_BRANCH],
      command: "git",
      cwd: args.repoRoot,
      env: gitEnv(),
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (fetchResult.code !== 0) {
      return {
        blocked: blocked(
          "fetch-failed",
          `Could not fetch ${UPSTREAM_REF}: ${fetchResult.outputTail.at(-1) ?? "git fetch failed"}`,
        ),
        current,
        incoming: null,
      };
    }
  }

  const upstream = await tryGit(args, [
    "rev-parse",
    "--verify",
    "--quiet",
    UPSTREAM_REF,
  ]);
  if (upstream === null) {
    return { blocked: localBlock, current, incoming: null };
  }
  const counts = await git(args, [
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${UPSTREAM_REF}`,
  ]);
  const [aheadText, behindText] = counts.split(/\s+/u);
  const ahead = Number(aheadText);
  const behind = Number(behindText);
  if (!Number.isInteger(behind) || behind === 0) {
    return { blocked: localBlock, current, incoming: null };
  }
  const subjects = (
    await git(args, [
      "log",
      "--format=%s",
      `-n${String(INCOMING_SUBJECT_LIMIT)}`,
      `HEAD..${UPSTREAM_REF}`,
    ])
  )
    .split("\n")
    .filter((line) => line.trim() !== "");
  return {
    blocked:
      localBlock ??
      (Number.isInteger(ahead) && ahead > 0
        ? blocked(
            "diverged",
            `Local ${SOURCE_BRANCH} has ${String(ahead)} commit${ahead === 1 ? "" : "s"} that ${UPSTREAM_REF} does not. Push or reset them to update from the app.`,
          )
        : null),
    current,
    incoming: {
      commit: upstream,
      commitCount: behind,
      subjects,
      version: await readVersionAt({ ...args, commit: upstream }),
    },
  };
}

export async function fastForwardSource(
  args: SourceGitArgs & { from: string; to: string },
): Promise<void> {
  const block = await readLocalBlock(args);
  if (block !== null) {
    throw new Error(block.message);
  }
  const head = await git(args, ["rev-parse", "HEAD"]);
  if (head !== args.from) {
    throw new Error(
      `The checkout moved to ${head.slice(0, 12)} after the update was requested.`,
    );
  }
  await git(args, ["merge", "--ff-only", "--quiet", args.to]);
}

export async function revertSource(
  args: SourceGitArgs & { to: string },
): Promise<void> {
  const head = await git(args, ["rev-parse", "HEAD"]);
  if (head === args.to) return;
  await git(args, ["reset", "--keep", args.to]);
}
