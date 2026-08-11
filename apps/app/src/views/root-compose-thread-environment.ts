import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { BaseBranchSpec, CreateThreadRequest } from "@bb/server-contract";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";

export interface RootComposeSelectedBranch {
  name: string;
  isNew: boolean;
}

export interface ResolveRootComposeThreadEnvironmentArgs {
  defaultBranch: string | null | undefined;
  defaultWorktreeBaseBranch: string | null | undefined;
  environmentValue: string;
  projectId: string | undefined;
  selectedBranch: RootComposeSelectedBranch | null;
}

interface ResolveManagedBaseBranchArgs {
  defaultBranch: string | null | undefined;
  defaultWorktreeBaseBranch: string | null | undefined;
  selectedBranch: RootComposeSelectedBranch | null;
}

function resolveManagedBaseBranch(
  args: ResolveManagedBaseBranchArgs,
): BaseBranchSpec {
  if (!args.selectedBranch) {
    if (
      args.defaultWorktreeBaseBranch &&
      args.defaultWorktreeBaseBranch !== args.defaultBranch
    ) {
      return { kind: "named", name: args.defaultWorktreeBaseBranch };
    }

    return { kind: "default" };
  }

  return { kind: "named", name: args.selectedBranch.name };
}

export function resolveRootComposeThreadEnvironment(
  args: ResolveRootComposeThreadEnvironmentArgs,
): CreateThreadRequest["environment"] | null {
  if (!args.projectId) return null;
  const parsed = parseEnvironmentValue(args.environmentValue);
  if (!parsed) return null;

  if (parsed.type === "reuse") {
    // Bare reuse value (mode picked but no worktree chosen yet) is an
    // incomplete state — submit is disabled by returning null.
    if (parsed.environmentId === null) return null;
    return { type: "reuse", environmentId: parsed.environmentId };
  }

  if (parsed.type === "host") {
    if (args.projectId === PERSONAL_PROJECT_ID) {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: { type: "personal" },
      };
    }

    if (parsed.mode === "worktree") {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: resolveManagedBaseBranch({
            defaultBranch: args.defaultBranch,
            defaultWorktreeBaseBranch: args.defaultWorktreeBaseBranch,
            selectedBranch: args.selectedBranch,
          }),
        },
      };
    }

    if (args.selectedBranch?.isNew) {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: {
          type: "unmanaged",
          path: null,
          branch: {
            kind: "new",
            baseBranch: args.selectedBranch.name,
          },
        },
      };
    }

    return {
      type: "host",
      hostId: parsed.hostId,
      workspace: {
        type: "unmanaged",
        path: null,
        ...(args.selectedBranch
          ? {
              branch: {
                kind: "existing",
                name: args.selectedBranch.name,
              },
            }
          : {}),
      },
    };
  }

  return null;
}
