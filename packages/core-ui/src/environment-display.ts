import type { Environment, EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import { resolveEnvironmentWorkspaceDisplayKind } from "@bb/domain";

export type EnvironmentDisplayHostLocality = "local" | "remote";

export interface EnvironmentDisplayHostContext {
  locality: EnvironmentDisplayHostLocality;
}

export interface EnvironmentDisplayInfo {
  /**
   * Human-readable environment label: a custom environment name when present,
   * "Provisioning" while the environment is still being set up, otherwise
   * "Working locally", "Working remotely", or "Worktree".
   */
  modeLabel: string;
  /**
   * Compact mode label for constrained prompt/composer surfaces. Custom names
   * stay custom names; generated direct-workspace labels compact to "Local" or
   * "Remote".
   */
  compactModeLabel: string;
  id: string;
  mode: "direct" | "worktree";
  workspaceDisplayKind: EnvironmentWorkspaceDisplayKind;
}

interface FormatEnvironmentDisplayArgs {
  environment: Environment;
  host: EnvironmentDisplayHostContext;
}

/**
 * Format an environment for display across app, CLI, and prompt labels.
 */
export function formatEnvironmentDisplay({
  environment,
  host,
}: FormatEnvironmentDisplayArgs): EnvironmentDisplayInfo {
  const mode: EnvironmentDisplayInfo["mode"] = environment.isWorktree
    ? "worktree"
    : "direct";
  const workspaceDisplayKind = resolveEnvironmentWorkspaceDisplayKind({
    environment: {
      isWorktree: environment.isWorktree,
      workspaceProvisionType: environment.workspaceProvisionType,
    },
  });

  // While the workspace is still being provisioned, discovered properties such
  // as `isWorktree` are not yet populated, so the mode is not yet knowable.
  // Managed worktrees can also sit in a prepared metadata-inference stage with
  // no workspace path before the actual provision request is queued. Report the
  // setup lifecycle honestly instead of guessing "Working locally".
  const isProvisioningDisplay =
    environment.status === "provisioning" ||
    (environment.workspaceProvisionType === "managed-worktree" &&
      environment.path === null);
  const directModeLabel =
    host.locality === "remote" ? "Working remotely" : "Working locally";
  const directCompactModeLabel =
    host.locality === "remote" ? "Remote" : "Local";
  const generatedModeLabel =
    isProvisioningDisplay
      ? "Provisioning"
      : mode === "worktree"
        ? "Worktree"
        : directModeLabel;
  const generatedCompactModeLabel =
    isProvisioningDisplay
      ? "Provisioning"
      : mode === "worktree"
        ? "Worktree"
        : directCompactModeLabel;
  const modeLabel = environment.name ?? generatedModeLabel;
  const compactModeLabel = environment.name ?? generatedCompactModeLabel;

  return {
    modeLabel,
    compactModeLabel,
    id: environment.id,
    mode,
    workspaceDisplayKind,
  };
}
