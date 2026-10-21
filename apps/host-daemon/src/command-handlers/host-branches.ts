import path from "node:path";
import {
  listWorkspaceBranchOptions,
  inspectWorkspaceGitSource,
} from "@bb/host-workspace";
import {
  CommandDispatchError,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { userExecutableProcessOptions } from "../user-executable-env.js";

export async function listHostBranchOptions(
  command: CommandOf<"host.list_branch_options">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
) {
  if (!path.isAbsolute(command.path))
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  return listWorkspaceBranchOptions({
    ...command,
    ...userExecutableProcessOptions(
      options?.runtimeManager.getShellEnv() ?? {},
    ),
  });
}
export async function inspectHostGitSource(
  command: CommandOf<"host.inspect_git_source">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
) {
  if (!path.isAbsolute(command.path))
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  return inspectWorkspaceGitSource({
    ...command,
    ...userExecutableProcessOptions(
      options?.runtimeManager.getShellEnv() ?? {},
    ),
  });
}
