import type { WorkspaceDiffTarget } from "bb-git-contract";

export function resolveDiffFileRef(
  target: WorkspaceDiffTarget,
  side: "old" | "new",
  mergeBaseRef: string | null,
): string | null | undefined {
  switch (target.type) {
    case "uncommitted":
      return side === "old" ? "HEAD" : undefined;
    case "branch_committed":
      return side === "old" ? mergeBaseRef : "HEAD";
    case "all":
      return side === "old" ? mergeBaseRef : undefined;
    case "commit":
      return side === "old" ? `${target.sha}^` : target.sha;
  }
}
