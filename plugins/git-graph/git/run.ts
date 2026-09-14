import { execFile, type ExecFileException } from "node:child_process";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitRunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export type GitRunner = (
  args: readonly string[],
  options?: GitRunOptions,
) => Promise<GitCommandResult>;

export const DEFAULT_GIT_TIMEOUT_MS = 20_000;

export class GitRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitRunnerError";
  }
}

export function hardenedGitEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...base, GIT_OPTIONAL_LOCKS: "0" };
}

export function createNodeGitRunner(gitPath: string): GitRunner {
  return (args, options) =>
    new Promise<GitCommandResult>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
      const maxBuffer = options?.maxOutputBytes ?? 4 * 1024 * 1024;
      execFile(
        gitPath,
        args,
        {
          timeout: timeoutMs,
          maxBuffer,
          windowsHide: true,
          encoding: "utf8",
          killSignal: "SIGKILL",
          env: hardenedGitEnvironment(),
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr, exitCode: 0 });
            return;
          }
          const failure = error as ExecFileException;
          if (typeof failure.code === "number") {
            resolve({
              stdout,
              stderr,
              exitCode: failure.code,
            });
            return;
          }
          if (failure.killed === true) {
            reject(
              new GitRunnerError(
                `git ${args[0] ?? ""} timed out after ${timeoutMs}ms`,
              ),
            );
            return;
          }
          reject(
            new GitRunnerError(
              `git ${args[0] ?? ""} failed to run (${failure.code ?? "unknown"}): ${failure.message}`,
            ),
          );
        },
      );
    });
}

const GIT_CANDIDATES = [
  "git",
  "C:\\Program Files\\Git\\cmd\\git.exe",
  "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];

export async function resolveGitExecutable(
  run: (
    file: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<string> {
  for (const candidate of GIT_CANDIDATES) {
    try {
      const { stdout } = await run(candidate, ["--version"]);
      if (stdout.includes("git version")) return candidate;
    } catch {}
  }
  throw new GitRunnerError(
    "Git executable not found. Install Git and reload the plugin.",
  );
}

let probedRunner: GitRunner | null = null;
let probeError: GitRunnerError | null = null;

async function probeRunner(): Promise<GitRunner> {
  if (probeError !== null) throw probeError;
  try {
    const gitPath = await resolveGitExecutable(
      (file, args) =>
        new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          execFile(
            file,
            args,
            { timeout: 5_000, windowsHide: true },
            (error, stdout, stderr) => {
              if (error !== null) reject(error);
              else resolve({ stdout, stderr });
            },
          );
        }),
    );
    probedRunner = createNodeGitRunner(gitPath);
  } catch (error) {
    probeError =
      error instanceof GitRunnerError
        ? error
        : new GitRunnerError(
            error instanceof Error ? error.message : String(error),
          );
    throw probeError;
  }
  return probedRunner;
}

export const lazyProbingGitRunner: GitRunner = async (args, options) => {
  const runner = probedRunner !== null ? probedRunner : await probeRunner();
  return await runner(args, options);
};
