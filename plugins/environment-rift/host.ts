import {
  experimental_defineHostEntry,
  experimental_spawnPortableOutputProcess as spawnPortableOutputProcess,
  experimental_killProcessGroup as killProcessGroup,
  experimental_supportsProcessGroups as supportsProcessGroups,
  experimental_sanitizeInheritedChildProcessEnv as sanitizeInheritedChildProcessEnv,
} from "@get-bb/plugin-sdk/host";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { withProcessLocalQueuedLocks } from "bb-environment-provider-host/locks";
import { createHostProgress } from "bb-environment-provider-host/progress";
import {
  runSetupScript,
  runTeardownScript,
} from "bb-environment-provider-host/setup-script";
import { riftHostContract, riftHostSignals } from "./contract.js";

type Runner = (
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
) => Promise<string>;
const run: Runner = async (command, args, cwd, signal) => {
  signal.throwIfAborted();
  const child = spawnPortableOutputProcess({
    command,
    args,
    cwd,
    detached: supportsProcessGroups(),
    env: sanitizeInheritedChildProcessEnv({ env: process.env }),
  });
  let output = "";
  let errors = "";
  let failure: Error | null = null;
  const stop = (error: Error) => {
    failure ??= error;
    killProcessGroup({ child, signal: "SIGKILL" });
  };
  const abort = () => stop(new Error("Rift operation cancelled"));
  const timer = setTimeout(
    () => stop(new Error("Rift command timed out")),
    15 * 60 * 1000,
  );
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const receive = (chunk: Buffer) => {
    if (output.length + chunk.length > 4 * 1024 * 1024)
      stop(new Error("Rift command output exceeded 4 MiB"));
    else output += chunk.toString("utf8");
  };
  child.stdout.on("data", receive);
  child.stderr.on("data", (chunk: Buffer) => {
    if (errors.length + chunk.length > 4 * 1024 * 1024)
      stop(new Error("Rift command output exceeded 4 MiB"));
    else errors += chunk.toString("utf8");
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (failure !== null) throw failure;
    if (code !== 0)
      throw new Error(
        `${command} ${args.join(" ")} failed: ${errors || output}`,
      );
    return output.trim();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
};

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

function targetFor(dataDir: string, pathKey: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(pathKey))
    throw new Error("Invalid Rift path key");
  return path.resolve(dataDir, "workspaces", pathKey, "workspace");
}

async function checkManaged(
  target: string,
  dataDir: string,
  pathKey: string,
): Promise<void> {
  if (target !== targetFor(dataDir, pathKey))
    throw new Error("Refusing to remove a path outside this Rift attempt");
  const root = path.resolve(dataDir, "workspaces");
  for (const item of [root, path.dirname(target), target]) {
    if (await exists(item)) {
      if ((await lstat(item)).isSymbolicLink())
        throw new Error("Refusing a symbolic link in a managed Rift path");
      if ((await realpath(item)) !== item)
        throw new Error("Managed Rift path is not canonical");
    }
  }
}

export function createRiftHostEntry(runner: Runner = run) {
  const initialize = async (sourcePath: string, signal: AbortSignal) => {
    const source = await realpath(sourcePath);
    return withProcessLocalQueuedLocks({
      locks: [{ key: `rift-init:${source}` }],
      signal,
      work: () => runner("rift", ["init", "--here"], source, signal),
    });
  };
  return experimental_defineHostEntry({
    contract: riftHostContract,
    experimental_signals: riftHostSignals,
    handlers: {
      async availability(_input, context) {
        try {
          await runner(
            "rift",
            ["--help"],
            context.experimental_paths.dataDir,
            context.signal,
          );
          return { installed: true };
        } catch {
          return { installed: false };
        }
      },
      async validate(input, context) {
        try {
          if (
            (await runner(
              "git",
              ["rev-parse", "--is-inside-work-tree"],
              input.sourcePath,
              context.signal,
            )) !== "true"
          )
            throw new Error("Rift needs a Git checkout");
          await runner(
            "git",
            ["rev-parse", "--verify", "HEAD"],
            input.sourcePath,
            context.signal,
          );
          if (!(await lstat(path.join(input.sourcePath, ".git"))).isDirectory())
            throw new Error(
              "Rift requires a standalone Git checkout; linked Git worktrees are not supported",
            );
          await access(input.sourcePath, 3);
          await initialize(input.sourcePath, context.signal);
          return { status: "accept" } as const;
        } catch (error) {
          return { status: "refuse", message: String(error) } as const;
        }
      },
      async resolvePath(input, context) {
        const dataDir = await realpath(context.experimental_paths.dataDir);
        const target = targetFor(dataDir, input.pathKey);
        await checkManaged(target, dataDir, input.pathKey);
        return { path: target };
      },
      async create(input, context) {
        const dataDir = await realpath(context.experimental_paths.dataDir);
        const target = targetFor(dataDir, input.pathKey);
        const completed = `${target}.completed`;
        const progress = createHostProgress({
          operationId: input.operationId,
          emit: (payload) =>
            context.experimental_emitSignal("progress", payload),
        });
        try {
          return await withProcessLocalQueuedLocks({
            locks: [{ key: target }],
            signal: context.signal,
            work: async () => {
              await checkManaged(target, dataDir, input.pathKey);
              const git = (args: string[], cwd = input.sourcePath) =>
                runner("git", args, cwd, context.signal);
              await git(["check-ref-format", "--branch", input.branchName]);
              if ((await exists(target)) && (await exists(completed))) {
                try {
                  const mergeBaseBranch = await readFile(completed, "utf8");
                  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(mergeBaseBranch))
                    throw new Error("Invalid Rift completion record");
                  await git(
                    ["cat-file", "-e", `${mergeBaseBranch}^{commit}`],
                    target,
                  );
                  if (
                    (await git(["branch", "--show-current"], target)) ===
                      input.branchName &&
                    (await exists(path.join(target, ".rift")))
                  ) {
                    await git(["rev-parse", "--verify", "HEAD"], target);
                    return {
                      status: "created",
                      path: target,
                      mergeBaseBranch,
                    } as const;
                  }
                } catch {
                  context.signal.throwIfAborted();
                }
              }
              if (await exists(target)) {
                try {
                  await runner(
                    "rift",
                    ["remove", target],
                    dataDir,
                    context.signal,
                  );
                } catch {
                  context.signal.throwIfAborted();
                  await rm(target, { recursive: true, force: true });
                }
              }
              await rm(completed, { force: true });
              await mkdir(path.dirname(target), { recursive: true });
              await initialize(input.sourcePath, context.signal);
              await runner(
                "rift",
                [
                  "create",
                  ...(input.copy === "all" ? ["--copy-all"] : []),
                  "--into",
                  path.dirname(target),
                  "--name",
                  "workspace",
                ],
                input.sourcePath,
                context.signal,
              );
              const mergeBaseBranch = await git(["rev-parse", "HEAD"], target);
              await git(
                ["checkout", "-B", input.branchName, mergeBaseBranch],
                target,
              );
              await runSetupScript({
                workspacePath: target,
                timeoutMs: input.setupTimeoutMs,
                onProgress: progress,
                signal: context.signal,
              });
              const temporary = `${completed}.tmp`;
              try {
                await writeFile(temporary, mergeBaseBranch);
                await rename(temporary, completed);
              } finally {
                await rm(temporary, { force: true });
              }
              return {
                status: "created",
                path: target,
                mergeBaseBranch,
              } as const;
            },
          });
        } catch (error) {
          if (context.signal.aborted) throw error;
          return { status: "failed", message: String(error) } as const;
        }
      },
      async remove(input, context) {
        try {
          const dataDir = await realpath(context.experimental_paths.dataDir);
          const target = input.path ?? targetFor(dataDir, input.pathKey);
          return await withProcessLocalQueuedLocks({
            locks: [{ key: target }],
            signal: context.signal,
            work: async () => {
              await checkManaged(target, dataDir, input.pathKey);
              if (await exists(target)) {
                await runTeardownScript({
                  workspacePath: target,
                  timeoutMs: input.teardownTimeoutMs,
                  signal: context.signal,
                });
                try {
                  await runner(
                    "rift",
                    ["remove", target],
                    dataDir,
                    context.signal,
                  );
                } catch {
                  context.signal.throwIfAborted();
                  await rm(target, { recursive: true, force: true });
                }
              }
              await rm(`${target}.completed`, { force: true });
              return { status: "removed" } as const;
            },
          });
        } catch (error) {
          if (context.signal.aborted) throw error;
          return { status: "failed", message: String(error) } as const;
        }
      },
    },
  });
}

export default createRiftHostEntry();
