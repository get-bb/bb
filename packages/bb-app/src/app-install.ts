import type { AppInstall } from "@bb/config/app-install";
import type { RunCommand } from "./app-update/run-command.js";

const OFFICIAL_SOURCE_REMOTE_PATTERN =
  /^(?:(?:https?|ssh|git):\/\/)?(?:[^@/]+@)?github\.com[:/]get-bb\/bb(?:\.git)?\/?$/iu;

export function isOfficialSourceRemote(url: string): boolean {
  return OFFICIAL_SOURCE_REMOTE_PATTERN.test(url.trim());
}

async function tryGit(args: {
  gitArgs: string[];
  repoRoot: string;
  runner: RunCommand;
}): Promise<string | null> {
  const result = await args.runner({
    args: args.gitArgs,
    command: "git",
    cwd: args.repoRoot,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function resolveAppInstall(args: {
  desktop: boolean;
  runner: RunCommand;
  sourceRoot: string | null;
}): Promise<AppInstall> {
  if (args.desktop) return { kind: "desktop" };
  if (args.sourceRoot === null) return { kind: "npm" };
  const git = { repoRoot: args.sourceRoot, runner: args.runner };
  const commit = await tryGit({ ...git, gitArgs: ["rev-parse", "HEAD"] });
  const remote =
    commit === null
      ? null
      : await tryGit({ ...git, gitArgs: ["remote", "get-url", "origin"] });
  if (commit === null || remote === null) {
    return { kind: "source", origin: "none" };
  }
  return isOfficialSourceRemote(remote)
    ? { commit, kind: "source", origin: "official" }
    : { kind: "source", origin: "fork" };
}
