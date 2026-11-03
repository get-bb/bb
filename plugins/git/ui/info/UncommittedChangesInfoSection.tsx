import {
  experimental_InfoSection as InfoSection,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import {
  ChangedFilesList,
  ChangedFilesTally,
  selectChangedFilesSection,
  useChangedFileActions,
  type ChangedFileActions,
} from "../changed-files.js";
import { useGitStatus } from "../queries.js";
import type { WorkspaceStatus } from "../../contract.js";

export function UncommittedChangesSectionView({
  workspace,
  actions,
}: {
  workspace: WorkspaceStatus | undefined;
  actions: ChangedFileActions;
}) {
  const section = selectChangedFilesSection(workspace, "uncommitted");
  if (section === undefined) return null;
  return (
    <InfoSection
      label="Uncommitted files"
      count={section.stats.fileCount}
      trailing={<ChangedFilesTally section={section} />}
    >
      <ChangedFilesList section={section} actions={actions} />
    </InfoSection>
  );
}

function UncommittedChangesContent({ environmentId }: { environmentId: string }) {
  const { workspace } = useGitStatus(environmentId);
  const actions = useChangedFileActions(environmentId);
  return <UncommittedChangesSectionView workspace={workspace} actions={actions} />;
}

export function UncommittedChangesInfoSection({
  environment,
}: ExperimentalThreadInfoProps) {
  return environment === null ? null : (
    <UncommittedChangesContent environmentId={environment.id} />
  );
}
