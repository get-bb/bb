import type { JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AppFixedTabDestination } from "@/lib/app-fixed-tab-navigation";
import type { AppFixedTabReference } from "@/lib/app-navigation-host";

type GitDiffFixedTabTarget =
  | { kind: "file"; path: string }
  | { kind: "commit"; sha: string };

const gitDiffFixedTabTargetSchema = z.union([
  z.object({ kind: z.literal("file"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("commit"), sha: z.string().min(1) }).strict(),
]);

export const GIT_DIFF_FIXED_TAB_REFERENCE: AppFixedTabReference = {
  ownerId: "core:git-diff",
  tabId: "changes",
};

function normalizeGitDiffFixedTabTarget(
  value: JsonValue,
): GitDiffFixedTabTarget | null {
  const parsed = gitDiffFixedTabTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createGitDiffFixedTabDestination({
  eligible,
  openCommit,
  openFile,
  openOrdinary,
}: {
  eligible: boolean;
  openCommit: (sha: string) => void;
  openFile: (path: string) => void;
  openOrdinary: () => void;
}): AppFixedTabDestination {
  return {
    tab: GIT_DIFF_FIXED_TAB_REFERENCE,
    open(target) {
      if (!eligible) return false;
      if (target === undefined) {
        openOrdinary();
        return true;
      }
      const normalized = normalizeGitDiffFixedTabTarget(target);
      if (normalized === null) return false;
      if (normalized.kind === "file") openFile(normalized.path);
      else openCommit(normalized.sha);
      return true;
    },
  };
}
