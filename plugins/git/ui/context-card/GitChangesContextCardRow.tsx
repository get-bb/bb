import {
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  experimental_useAppPanel as useAppPanel,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk/app";
import {
  CHANGED_FILES_KIND_PREFIX,
  formatChangeSummary,
  selectWorkspaceChangedFilesSection,
  toChangeTally,
} from "@bb/shared-ui/workspace-change-summary";
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
  const section = selectWorkspaceChangedFilesSection(workspace);
  if (section === null) return null;
  const tally = toChangeTally(section.stats);
  return (
    <ThreadContextCardRow
      icon="FileDiff"
      label="Changes"
      title={`${CHANGED_FILES_KIND_PREFIX[section.kind]}: ${formatChangeSummary(tally)}`}
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
