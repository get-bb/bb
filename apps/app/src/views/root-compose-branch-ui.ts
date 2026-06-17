import type {
  GitCheckoutRef,
  ProjectSourceCheckout,
  WorkspaceGitOperation,
} from "@bb/domain";
import type { RootComposeSelectedBranch } from "./root-compose-thread-environment";

export type RootComposeBranchEnvironmentMode = "local" | "worktree" | "other";

export interface BranchMutationBlocker {
  label: string;
  title: string;
}

export interface RootComposeBranchUiState {
  currentBranch: string | null;
  currentOptionLabel: string | null;
  mutationBlocker: BranchMutationBlocker | null;
  placeholder: string;
  triggerLabel: string;
  triggerTitle: string;
}

type RootComposeBranchCheckout = ProjectSourceCheckout & {
  defaultWorktreeBaseBranch?: string | null;
};

export interface BuildRootComposeBranchUiStateArgs {
  checkout: RootComposeBranchCheckout | undefined;
  isFetching: boolean;
  isLoading: boolean;
  mode: RootComposeBranchEnvironmentMode;
  selectedBranch: RootComposeSelectedBranch | null;
}

interface BuildWorktreeBranchUiStateArgs {
  checkout: RootComposeBranchCheckout | undefined;
  selectedBranch: RootComposeSelectedBranch | null;
}

function formatOperationName(operation: WorkspaceGitOperation): string {
  switch (operation.kind) {
    case "merge":
      return "Merge";
    case "rebase":
      return "Rebase";
    case "cherry-pick":
      return "Cherry-pick";
    case "revert":
      return "Revert";
    case "unknown":
      return "Operation";
    case "none":
      return "";
  }
}

function getCheckoutBranchName(
  checkout: GitCheckoutRef | undefined,
): string | null {
  if (checkout?.kind !== "branch") {
    return null;
  }
  return checkout.branchName;
}

function getOperationConflictState(operation: WorkspaceGitOperation): boolean {
  return operation.kind !== "none" && operation.hasConflicts;
}

function formatCurrentCheckoutLabel(
  checkout: GitCheckoutRef | undefined,
): string {
  switch (checkout?.kind) {
    case "branch":
      return `Current: ${checkout.branchName}`;
    case "detached":
      return "Current (detached)";
    case "unborn":
      return "Current (empty repo)";
    case "unknown":
      return "Unknown checkout";
    case undefined:
      return "Checking checkout";
  }
}

function formatCurrentCheckoutTriggerLabel(
  checkout: GitCheckoutRef | undefined,
): string {
  switch (checkout?.kind) {
    case "branch":
      return `Current (${checkout.branchName})`;
    case "detached":
      return "Current (detached)";
    case "unborn":
      return "Current (empty repo)";
    case "unknown":
    case undefined:
      return formatCurrentCheckoutLabel(checkout);
  }
}

function formatBranchFromOptionLabel(
  defaultBranch: string | null | undefined,
): string {
  return defaultBranch ?? "default";
}

function formatBranchFromTriggerLabel(
  defaultBranch: string | null | undefined,
): string {
  return `Branch from: ${defaultBranch ?? "default"}`;
}

function formatNewBranchTriggerLabel(branchName: string): string {
  return `New branch from: ${branchName}`;
}

function formatCheckoutBranchTriggerLabel(branchName: string): string {
  return `Checkout: ${branchName}`;
}

function formatCheckoutBranchTriggerTitle(branchName: string): string {
  return `Checkout branch: ${branchName}`;
}

function buildOperationBlocker(
  operation: WorkspaceGitOperation,
): BranchMutationBlocker | null {
  if (operation.kind === "none") {
    return null;
  }

  const operationName = formatOperationName(operation);
  if (getOperationConflictState(operation)) {
    return {
      label: "Conflicts",
      title: "Checkout blocked by unresolved conflicts",
    };
  }

  return {
    label: operationName,
    title: `Checkout blocked by an in-progress ${operationName.toLowerCase()}`,
  };
}

export function resolveBranchMutationBlocker(
  args: BuildRootComposeBranchUiStateArgs,
): BranchMutationBlocker | null {
  if (args.mode !== "local") {
    return null;
  }

  if (args.isLoading || (args.isFetching && !args.checkout)) {
    return {
      label: "Checking",
      title: "Checking checkout state",
    };
  }

  if (!args.checkout) {
    return {
      label: "Unknown",
      title: "Checkout state is unavailable",
    };
  }

  const operationBlocker = buildOperationBlocker(args.checkout.operation);
  if (operationBlocker) {
    return operationBlocker;
  }

  if (args.checkout.hasUncommittedChanges) {
    return {
      label: "Dirty",
      title: "Checkout blocked by uncommitted changes",
    };
  }

  switch (args.checkout.checkout.kind) {
    case "branch":
      return null;
    case "detached":
      return {
        label: "Detached",
        title: "Checkout blocked while HEAD is detached",
      };
    case "unborn":
      return {
        label: "Empty repo",
        title: "Checkout blocked before the first commit",
      };
    case "unknown":
      return {
        label: "Unknown",
        title: "Checkout state is unavailable",
      };
  }
}

function buildWorktreeBranchUiState(
  args: BuildWorktreeBranchUiStateArgs,
): RootComposeBranchUiState {
  const defaultBaseBranch =
    args.checkout?.defaultWorktreeBaseBranch ?? args.checkout?.defaultBranch;
  const defaultOptionLabel = formatBranchFromOptionLabel(defaultBaseBranch);
  const defaultTriggerLabel = formatBranchFromTriggerLabel(defaultBaseBranch);

  if (args.selectedBranch) {
    return {
      currentBranch: defaultBaseBranch ?? null,
      currentOptionLabel: defaultOptionLabel,
      mutationBlocker: null,
      placeholder: "Branch from: default",
      triggerLabel: `Branch from: ${args.selectedBranch.name}`,
      triggerTitle: `Branch from: ${args.selectedBranch.name}`,
    };
  }

  return {
    currentBranch: defaultBaseBranch ?? null,
    currentOptionLabel: defaultOptionLabel,
    mutationBlocker: null,
    placeholder: "Branch from: default",
    triggerLabel: defaultTriggerLabel,
    triggerTitle: defaultTriggerLabel,
  };
}

export function buildRootComposeBranchUiState(
  args: BuildRootComposeBranchUiStateArgs,
): RootComposeBranchUiState {
  if (args.mode === "worktree") {
    return buildWorktreeBranchUiState(args);
  }

  if (args.mode !== "local") {
    return {
      currentBranch: null,
      currentOptionLabel: null,
      mutationBlocker: null,
      placeholder: "Select branch",
      triggerLabel: "Select branch",
      triggerTitle: "Select branch",
    };
  }

  const mutationBlocker = resolveBranchMutationBlocker(args);
  const currentBranch = getCheckoutBranchName(args.checkout?.checkout);
  const currentOptionLabel = formatCurrentCheckoutLabel(
    args.checkout?.checkout,
  );
  if (args.selectedBranch?.isNew) {
    return {
      currentBranch,
      currentOptionLabel,
      mutationBlocker,
      placeholder: "Current checkout",
      triggerLabel: formatNewBranchTriggerLabel(args.selectedBranch.name),
      triggerTitle:
        mutationBlocker?.title ??
        `Create a new branch from ${args.selectedBranch.name}`,
    };
  }

  if (args.selectedBranch) {
    return {
      currentBranch,
      currentOptionLabel,
      mutationBlocker,
      placeholder: "Current checkout",
      triggerLabel: formatCheckoutBranchTriggerLabel(args.selectedBranch.name),
      triggerTitle:
        mutationBlocker?.title ??
        formatCheckoutBranchTriggerTitle(args.selectedBranch.name),
    };
  }

  return {
    currentBranch,
    currentOptionLabel,
    mutationBlocker,
    placeholder: "Current checkout",
    triggerLabel: formatCurrentCheckoutTriggerLabel(args.checkout?.checkout),
    triggerTitle: currentOptionLabel,
  };
}
