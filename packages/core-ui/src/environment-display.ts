import type { Environment, EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import { resolveEnvironmentWorkspaceDisplayKind } from "@bb/domain";

type EnvironmentDisplayHostLocality = "local" | "remote";

/** Identity of the machine an environment lives on, for multi-machine
 * surfaces that name the machine (thread metadata, offline notices). */
interface EnvironmentDisplayHostIdentity {
  name: string;
  connected: boolean;
}

export interface EnvironmentDisplayHostContext {
  locality: EnvironmentDisplayHostLocality;
  /** Null when the machine shouldn't be named — single-host setups or the
   * only one machine being available. */
  identity: EnvironmentDisplayHostIdentity | null;
}

export interface EnvironmentDisplayInfo {
  /**
   * Human-readable environment label: a custom environment name when present,
   * "Provisioning" while the environment is still being set up, "Destroying"
   * while it is torn down, "Destroyed" once it is gone, otherwise "Working
   * locally", "Working remotely", or "Worktree".
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
  // A destroyed managed worktree also has no path. It is gone, not being set
  // up, so it must not read as "Provisioning" (#1789).
  const goneLabel =
    environment.status === "destroying"
      ? "Destroying"
      : environment.status === "destroyed"
        ? "Destroyed"
        : null;
  const isProvisioningDisplay =
    goneLabel === null &&
    (environment.status === "provisioning" ||
      (environment.workspaceProvisionType === "managed-worktree" &&
        environment.path === null));
  const directModeLabel =
    host.locality === "remote" ? "Working remotely" : "Working locally";
  const directCompactModeLabel =
    host.locality === "remote" ? "Remote" : "Local";
  const generatedModeLabel = goneLabel
    ? goneLabel
    : isProvisioningDisplay
      ? "Provisioning"
      : mode === "worktree"
        ? "Worktree"
        : directModeLabel;
  const generatedCompactModeLabel = goneLabel
    ? goneLabel
    : isProvisioningDisplay
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
