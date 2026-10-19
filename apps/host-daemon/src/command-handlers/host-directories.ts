import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { getGitCommonDir, type GitProcessOptions } from "@bb/host-workspace";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type {
  CommandDispatchOptions,
  CommandOf,
} from "../command-dispatch-support.js";
import { userExecutableProcessOptions } from "../user-executable-env.js";

type ResolvedDirectory =
  HostDaemonOnlineRpcResult<"host.resolve_directories">["entries"][number];

async function resolveRealDirectory(candidate: string): Promise<string | null> {
  if (!path.isAbsolute(candidate)) {
    return null;
  }
  try {
    const resolved = await realpath(candidate);
    return (await stat(resolved)).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

async function resolveGitCommonDir(
  directory: string,
  options: GitProcessOptions,
): Promise<string | null> {
  try {
    const commonDir = await getGitCommonDir(directory, options);
    return await realpath(path.resolve(directory, commonDir));
  } catch {
    return null;
  }
}

async function resolveDirectory(
  candidate: string,
  options: GitProcessOptions,
): Promise<ResolvedDirectory> {
  const realPath = await resolveRealDirectory(candidate);
  return {
    path: candidate,
    realPath,
    gitCommonDir:
      realPath === null ? null : await resolveGitCommonDir(realPath, options),
  };
}

export async function resolveHostDirectories(
  command: CommandOf<"host.resolve_directories">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.resolve_directories">> {
  const gitProcessOptions = userExecutableProcessOptions(
    options?.runtimeManager.getShellEnv() ?? {},
  );
  return {
    entries: await Promise.all(
      command.paths.map((candidate) =>
        resolveDirectory(candidate, gitProcessOptions),
      ),
    ),
  };
}
