import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { BaseBranchSpec, CreateThreadRequest } from "@bb/server-contract";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";

export interface RootComposeSelectedBranch {
  name: string;
  isNew: boolean;
}

interface ResolveRootComposeThreadEnvironmentArgs {
  environmentValue: string;
  projectId: string | undefined;
  selectedBranch: RootComposeSelectedBranch | null;
}

function resolveManagedBaseBranch(
  selectedBranch: RootComposeSelectedBranch | null,
): BaseBranchSpec {
  if (!selectedBranch) {
    return { kind: "default" };
  }

  return { kind: "named", name: selectedBranch.name };
}

export function resolveRootComposeThreadEnvironment(
  args: ResolveRootComposeThreadEnvironmentArgs,
): CreateThreadRequest["environment"] | null {
  if (!args.projectId) return null;
  const parsed = parseEnvironmentValue(args.environmentValue);
  if (!parsed) return null;

  if (parsed.type === "reuse") {
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
          baseBranch: resolveManagedBaseBranch(args.selectedBranch),
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
