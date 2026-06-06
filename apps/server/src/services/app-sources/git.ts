import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_COMMAND_TIMEOUT_MS = 120_000;
const GIT_OUTPUT_MAX_BYTES = 10 * 1024 * 1024;

interface RunGitArgs {
  args: readonly string[];
  cwd: string;
}

export class GitCommandError extends Error {
  constructor(args: RunGitArgs, detail: string) {
    super(`git ${args.args.join(" ")} failed: ${detail}`);
    this.name = "GitCommandError";
  }
}

function extractGitErrorDetail(error: unknown): string {
  if (error && typeof error === "object") {
    if ("killed" in error && error.killed === true) {
      return "timed out";
    }
    if (
      "stderr" in error &&
      typeof error.stderr === "string" &&
      error.stderr.trim().length > 0
    ) {
      return error.stderr.trim();
    }
  }
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * Runs git non-interactively with a hard timeout. GIT_TERMINAL_PROMPT=0 turns
 * missing credentials into a fast failure instead of a hung prompt; callers
 * surface the stderr detail as the source's lastError.
 */
export async function runGit(args: RunGitArgs): Promise<string> {
  try {
    const result = await execFileAsync("git", [...args.args], {
      cwd: args.cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    return result.stdout.trim();
  } catch (error) {
    throw new GitCommandError(args, extractGitErrorDetail(error));
  }
}
