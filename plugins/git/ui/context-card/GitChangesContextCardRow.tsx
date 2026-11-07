import {
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  experimental_useAppPanel as useAppPanel,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk/app";
import {
  formatChangeSummary,
  toChangeTally,
} from "../workspace-change-summary.js";
import { DiffStatsTally } from "@bb/shared-ui/diff-stats-tally";
import { GIT_DIFF_TAB_ID } from "../../contract.js";
import { useGitStatus, useShowGitChanges } from "../queries.js";

export function GitChangesContextCardRow({
  environment,
}: ExperimentalThreadContextCardProps) {
  const environmentId = useShowGitChanges() ? (environment?.id ?? null) : null;
  const { workspace } = useGitStatus(environmentId);
  const panel = useAppPanel();
  if (environmentId === null || !workspace) return null;
  if (workspace.allChanges.fileCount === 0) return null;
  const tally = toChangeTally(workspace.allChanges);
  return (
    <ThreadContextCardRow
      icon="FileDiff"
      label="Changes"
      title={`All changes: ${formatChangeSummary(tally)}`}
      trailing={
        <DiffStatsTally
          insertions={tally.insertions}
          deletions={tally.deletions}
        />
      }
      onClick={() =>
        panel.openTab({
          tab: {
            id: GIT_DIFF_TAB_ID,
            context: { kind: "thread" },
            availability: "fixed",
          },
        })
      }
    />
  );
}
