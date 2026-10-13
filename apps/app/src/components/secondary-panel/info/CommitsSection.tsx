import type { WorkspaceStatus } from "@bb/domain";
import type { WorkspaceChangedFileSelection } from "@/components/workspace/workspace-change-summary";
import { selectWorkspaceAheadCommits } from "@/components/workspace/workspace-change-summary";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  ChangedFilesList,
  ChangedFilesTally,
  selectChangedFilesSection,
} from "./ChangesSection";
import {
  InfoList,
  InfoListRow,
  InfoRowTime,
  InfoSection,
  InfoSubheading,
} from "./info-list";
import { useInfoSectionCollapse } from "./useInfoSectionCollapse";

interface CommitsSectionProps {
  workspaceStatus: WorkspaceStatus | undefined;
  onCommitClick?: (sha: string) => void;
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
  onOpenChangedFile?: (path: string) => void;
}

export function CommitsSection({
  workspaceStatus,
  onCommitClick,
  onChangedFileClick,
  onOpenChangedFile,
}: CommitsSectionProps) {
  const commits = selectWorkspaceAheadCommits(workspaceStatus);
  const committedFiles = selectChangedFilesSection(
    workspaceStatus,
    "committed",
  );
  const collapse = useInfoSectionCollapse("commits");
  if (commits.length === 0 && committedFiles === undefined) return null;
  return (
    <InfoSection label="Commits" count={commits.length} collapse={collapse}>
      <InfoList
        items={commits}
        rail
        getKey={(commit) => commit.sha}
        renderItem={(commit) => (
          <InfoListRow
            leading={
              <span className="size-[7px] rounded-full border border-subtle-foreground/60 bg-background group-hover:border-subtle-foreground" />
            }
            name={commit.subject}
            title={commit.subject}
            target={
              onCommitClick
                ? { kind: "button", onSelect: () => onCommitClick(commit.sha) }
                : null
            }
            actions={[
              ...(onCommitClick
                ? [
                    {
                      icon: "ExternalLink" as const,
                      label: "Open diff",
                      onSelect: () => onCommitClick(commit.sha),
                    },
                  ]
                : []),
              {
                icon: "Copy",
                label: "Copy commit SHA",
                onSelect: () => {
                  void copyToClipboardWithToast(commit.sha, {
                    successMessage: "Commit SHA copied",
                    errorMessage: "Failed to copy commit SHA",
                  });
                },
              },
            ]}
            trailing={
              <InfoRowTime
                timestamp={commit.authoredAt}
                detail={`${commit.shortSha} · ${commit.authorName}`}
              />
            }
          />
        )}
      />
      {committedFiles ? (
        <>
          <InfoSubheading
            label="Files changed"
            count={committedFiles.files.length}
            trailing={<ChangedFilesTally section={committedFiles} />}
          />
          <ChangedFilesList
            section={committedFiles}
            onChangedFileClick={onChangedFileClick}
            onOpenChangedFile={onOpenChangedFile}
          />
        </>
      ) : null}
    </InfoSection>
  );
}
