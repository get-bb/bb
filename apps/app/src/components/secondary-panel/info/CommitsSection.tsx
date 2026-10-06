import type { WorkspaceStatus } from "@bb/domain";
import { selectWorkspaceAheadCommits } from "@/components/workspace/workspace-change-summary";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  InfoList,
  InfoListRow,
  InfoRowAction,
  InfoRowTime,
  InfoSection,
} from "./info-list";

interface CommitsSectionProps {
  workspaceStatus: WorkspaceStatus | undefined;
  onCommitClick?: (sha: string) => void;
}

export function CommitsSection({
  workspaceStatus,
  onCommitClick,
}: CommitsSectionProps) {
  const commits = selectWorkspaceAheadCommits(workspaceStatus);
  if (commits.length === 0) return null;
  return (
    <InfoSection label="Commits" count={commits.length}>
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
            action={
              <>
                {onCommitClick ? (
                  <InfoRowAction
                    icon="ExternalLink"
                    label="Open in Diff tab"
                    onClick={() => onCommitClick(commit.sha)}
                  />
                ) : null}
                <InfoRowAction
                  icon="Copy"
                  label={`Copy commit ${commit.shortSha} SHA`}
                  tooltip
                  onClick={() => {
                    void copyToClipboardWithToast(commit.sha, {
                      successMessage: "Commit SHA copied",
                      errorMessage: "Failed to copy commit SHA",
                    });
                  }}
                />
              </>
            }
            trailing={
              <InfoRowTime
                timestamp={commit.authoredAt}
                detail={`${commit.shortSha} · ${commit.authorName}`}
              />
            }
          />
        )}
      />
    </InfoSection>
  );
}
