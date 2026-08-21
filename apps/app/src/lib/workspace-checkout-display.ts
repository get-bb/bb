import type { GitCheckoutRef } from "@bb/domain";

const SHORT_SHA_LENGTH = 7;

export interface WorkspaceCheckoutDisplay {
  copyErrorMessage: string | null;
  copyLabel: string | null;
  copySuccessMessage: string | null;
  copyValue: string | null;
  label: string;
  rowLabel: "Branch" | "Bookmark" | "Checkout";
  title: string;
}

interface FormatWorkspaceCheckoutDisplayArgs {
  checkout: GitCheckoutRef;
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

export function formatWorkspaceCheckoutDisplay({
  checkout,
}: FormatWorkspaceCheckoutDisplayArgs): WorkspaceCheckoutDisplay {
  switch (checkout.kind) {
    case "branch":
      return {
        copyErrorMessage: "Failed to copy branch name",
        copyLabel: "Copy branch name",
        copySuccessMessage: "Branch name copied",
        copyValue: checkout.branchName,
        label: checkout.branchName,
        rowLabel: "Branch",
        title: `Copy branch name: ${checkout.branchName}`,
      };
    case "detached":
      if (checkout.headSha === null) {
        return {
          copyErrorMessage: null,
          copyLabel: null,
          copySuccessMessage: null,
          copyValue: null,
          label: "detached HEAD",
          rowLabel: "Checkout",
          title: "Detached HEAD",
        };
      }
      if (checkout.jj) {
        if (checkout.jj.bookmark !== null) {
          return {
            copyErrorMessage: "Failed to copy bookmark name",
            copyLabel: "Copy bookmark name",
            copySuccessMessage: "Bookmark name copied",
            copyValue: checkout.jj.bookmark,
            label: checkout.jj.bookmark,
            rowLabel: "Bookmark",
            title: `Copy bookmark name: ${checkout.jj.bookmark}`,
          };
        }
        return {
          copyErrorMessage: "Failed to copy commit SHA",
          copyLabel: "Copy commit SHA",
          copySuccessMessage: "Commit SHA copied",
          copyValue: checkout.headSha,
          label: `jj ${shortSha(checkout.headSha)}`,
          rowLabel: "Bookmark",
          title: `jj checkout without a bookmark: ${checkout.headSha}`,
        };
      }
      return {
        copyErrorMessage: "Failed to copy commit SHA",
        copyLabel: "Copy commit SHA",
        copySuccessMessage: "Commit SHA copied",
        copyValue: checkout.headSha,
        label: `detached ${shortSha(checkout.headSha)}`,
        rowLabel: "Checkout",
        title: `Detached HEAD: ${checkout.headSha}`,
      };
    case "unborn":
      return {
        copyErrorMessage: null,
        copyLabel: null,
        copySuccessMessage: null,
        copyValue: null,
        label:
          checkout.branchName !== null
            ? `${checkout.branchName} (empty)`
            : "empty repo",
        rowLabel: "Checkout",
        title:
          checkout.branchName !== null
            ? `Empty branch: ${checkout.branchName}`
            : "Empty repository",
      };
    case "unknown":
      return {
        copyErrorMessage: null,
        copyLabel: null,
        copySuccessMessage: null,
        copyValue: null,
        label: "unknown checkout",
        rowLabel: "Checkout",
        title: `Unknown checkout: ${checkout.reason}`,
      };
  }
}
