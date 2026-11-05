import type { TimelineFileChange } from "@bb/server-contract";
import {
  getFileChangeAction,
  getFileChangeDiffLines,
  isPlainFileContentDiff,
  type FileChangeAction,
} from "@bb/thread-view";

export interface RenderablePatchText {
  disableLineNumbers: boolean;
  patch: string;
}

type SyntheticPatchAction = "created" | "deleted";

function normalizePatchPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/u, "");
}

function toSyntheticPatch(
  change: TimelineFileChange,
  action: SyntheticPatchAction,
): string | null {
  const contentPrefix = action === "created" ? "+" : "-";
  const bodyLines = getFileChangeDiffLines(change).filter((line) =>
    line.startsWith(contentPrefix),
  );
  if (bodyLines.length === 0) return null;
  const normalizedPath = normalizePatchPath(change.path);
  const fromPath = action === "created" ? "/dev/null" : `a/${normalizedPath}`;
  const toPath = action === "created" ? `b/${normalizedPath}` : "/dev/null";
  const oldCount = action === "created" ? 0 : bodyLines.length;
  const newCount = action === "created" ? bodyLines.length : 0;
  const body = bodyLines.join("\n");
  return `diff --git a/${normalizedPath} b/${normalizedPath}\n--- ${fromPath}\n+++ ${toPath}\n@@ -1,${oldCount} +1,${newCount} @@\n${body}\n`;
}

function toSyntheticUpdatePatch(change: TimelineFileChange): string | null {
  const bodyLines = getFileChangeDiffLines(change);
  if (bodyLines.length === 0) {
    return null;
  }
  const hasUnifiedLines = bodyLines.some(
    (line) => line.startsWith("+") || line.startsWith("-"),
  );
  if (!hasUnifiedLines) {
    return null;
  }

  const normalizedPath = normalizePatchPath(change.movePath ?? change.path);
  const removedCount = bodyLines.filter((line) => line.startsWith("-")).length;
  const addedCount = bodyLines.filter((line) => line.startsWith("+")).length;
  return `diff --git a/${normalizedPath} b/${normalizedPath}\n--- a/${normalizedPath}\n+++ b/${normalizedPath}\n@@ -1,${Math.max(removedCount, 1)} +1,${Math.max(addedCount, 1)} @@\n${bodyLines.join("\n")}\n`;
}

export function getRenderablePatchText(
  change: TimelineFileChange,
): RenderablePatchText | null {
  const patch = change.diff;
  if (patch && patch.trim().length > 0 && !isPlainFileContentDiff(change)) {
    const trimmedPatch = patch.trimEnd();
    if (
      trimmedPatch.startsWith("diff --git") ||
      (trimmedPatch.includes("--- ") &&
        trimmedPatch.includes("+++ ") &&
        trimmedPatch.includes("@@"))
    ) {
      return {
        patch,
        disableLineNumbers: false,
      };
    }
    if (patch.includes("@@")) {
      const normalizedPath = normalizePatchPath(change.movePath ?? change.path);
      return {
        patch: `diff --git a/${normalizedPath} b/${normalizedPath}\n--- a/${normalizedPath}\n+++ b/${normalizedPath}\n${patch.trimEnd()}\n`,
        disableLineNumbers: false,
      };
    }
  }

  const action: FileChangeAction = getFileChangeAction(change);
  const syntheticPatch =
    (action === "created"
      ? toSyntheticPatch(change, "created")
      : action === "deleted"
        ? toSyntheticPatch(change, "deleted")
        : null) ?? toSyntheticUpdatePatch(change);
  if (!syntheticPatch) {
    return null;
  }
  return {
    patch: syntheticPatch,
    disableLineNumbers: true,
  };
}

export function getPlainDiffFallback(
  change: TimelineFileChange,
  hasRenderablePatch: boolean,
): string | null {
  if (hasRenderablePatch) {
    return null;
  }
  const diff = change.diff?.trimEnd();
  return diff && diff.length > 0 ? diff : null;
}
