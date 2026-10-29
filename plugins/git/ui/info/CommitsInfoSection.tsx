import {
  experimental_copyToClipboard,
  experimental_InfoList as InfoList,
  experimental_InfoSection as InfoSection,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import { InfoListRow, InfoRowTime } from "@bb/shared-ui/info-list-row";
import { InfoListRail, InfoSubheading } from "./info-parts.js";
import { toast } from "sonner";
import { selectWorkspaceAheadCommits } from "@bb/shared-ui/workspace-change-summary";
import {
  ChangedFilesList,
  ChangedFilesTally,
  selectChangedFilesSection,
  useChangedFileActions,
  type ChangedFileActions,
} from "../changed-files.js";
import { useGitStatus } from "../queries.js";
import type { WorkspaceStatus } from "../../contract.js";

function copyCommitSha(sha: string): void {
  void experimental_copyToClipboard({ text: sha }).then((written) => {
    if (written) toast.success("Commit SHA copied");
    else toast.error("Failed to copy commit SHA");
  });
}

export function CommitsSectionView({
  workspace,
  actions,
}: {
  workspace: WorkspaceStatus | undefined;
  actions: ChangedFileActions;
}) {
  const commits = selectWorkspaceAheadCommits(workspace);
  const committedFiles = selectChangedFilesSection(workspace, "committed");
  if (commits.length === 0 && committedFiles === undefined) return null;
  return (
    <InfoSection label="Commits" count={commits.length}>
      <InfoListRail count={commits.length}>
        <InfoList
          items={commits}
          getKey={(commit) => commit.sha}
          renderItem={(commit) => (
            <InfoListRow
              leading={
                <span className="size-[7px] rounded-full border border-subtle-foreground/60 bg-background group-hover:border-subtle-foreground" />
              }
              name={commit.subject}
              title={commit.subject}
              target={{
                kind: "button",
                onSelect: () => actions.onCommitClick(commit.sha),
              }}
              actions={[
                {
                  icon: "ExternalLink",
                  label: "Open diff",
                  onSelect: () => actions.onCommitClick(commit.sha),
                },
                {
                  icon: "Copy",
                  label: "Copy commit SHA",
                  onSelect: () => copyCommitSha(commit.sha),
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
      </InfoListRail>
      {committedFiles ? (
        <>
          <InfoSubheading
            label="Files changed"
            count={committedFiles.stats.fileCount}
            trailing={<ChangedFilesTally section={committedFiles} />}
          />
          <ChangedFilesList section={committedFiles} actions={actions} />
        </>
      ) : null}
    </InfoSection>
  );
}

function CommitsSectionContent({ environmentId }: { environmentId: string }) {
  const { workspace } = useGitStatus(environmentId);
  const actions = useChangedFileActions(environmentId);
  return <CommitsSectionView workspace={workspace} actions={actions} />;
}

export function CommitsInfoSection({
  environment,
}: ExperimentalThreadInfoProps) {
  return environment === null ? null : (
    <CommitsSectionContent environmentId={environment.id} />
  );
}
