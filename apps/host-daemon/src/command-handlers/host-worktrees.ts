import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { listGitWorktrees, resolveHostPaths } from "@bb/host-workspace";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type {
  CommandDispatchOptions,
  CommandOf,
} from "../command-dispatch-support.js";
import { userExecutableProcessOptions } from "../user-executable-env.js";

/**
 * Raw host-local worktree facts for project discovery. The daemon reports
 * what git and the filesystem say — including stale and locked registrations —
 * and canonicalizes paths here because the server cannot realpath a remote
 * host's paths. Availability, ownership, and environment merging are server
 * policy.
 */
export async function listHostWorktrees(
  command: CommandOf<"host.list_worktrees">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.list_worktrees">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }
  for (const comparisonPath of command.comparisonPaths) {
    if (!path.isAbsolute(comparisonPath)) {
      throw new CommandDispatchError(
        "invalid_path",
        "Comparison paths must be absolute",
      );
    }
  }

  const gitProcessOptions = userExecutableProcessOptions(
    options?.runtimeManager.getShellEnv() ?? {},
  );
  const [worktrees, resolvedPaths] = await Promise.all([
    listGitWorktrees(command.path, gitProcessOptions),
    resolveHostPaths(command.comparisonPaths),
  ]);
  return { worktrees, resolvedPaths };
}
