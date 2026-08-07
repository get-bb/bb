import { useMemo } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { HostDirectoryListing } from "@bb/server-contract";
import {
  ProjectPathDialogContent,
  type ProjectPathDialogTarget,
} from "./ProjectPathDialog";
import { hostDirectoryQueryKey } from "@/hooks/queries/query-keys";
import { createAppQueryClient } from "@/lib/query-client";
import {
  HOST_IDS,
  HOST_NAMES,
  makeHost,
  PROJECT_IDS,
  PROJECT_NAMES,
} from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Project Path",
};

const noop = async () => {};

const createTarget: ProjectPathDialogTarget = { kind: "create" };

const updateTarget: ProjectPathDialogTarget = {
  kind: "update",
  projectId: PROJECT_IDS.bb,
  projectName: PROJECT_NAMES.bb,
  currentPath: "/Users/michael/Projects/bb",
};

const addSourceTarget: ProjectPathDialogTarget = {
  kind: "add-source",
  projectId: PROJECT_IDS.bb,
  projectName: PROJECT_NAMES.bb,
};

const connectedMachine = makeHost();
const offlineMachine = makeHost({
  id: HOST_IDS.remote,
  name: HOST_NAMES.remote,
  status: "disconnected",
});
const offlineLocalMachine = makeHost({ status: "disconnected" });

const longNamesMachine = makeHost({
  id: "host_long_names",
  name: "sandbox",
});
const longProjectName = "long-project-name-".repeat(18);
const longProjectPath = `/home/winter/${longProjectName}`;
const longFileName = `${"appdata-buzz-pre-sandbox-migration-".repeat(8)}.tar.gz`;
const longFolderName = "long-folder-name-without-natural-breaks-".repeat(8);

function createLongNamesQueryClient() {
  const queryClient = createAppQueryClient({
    showMutationErrorToasts: false,
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });
  queryClient.setQueryData<HostDirectoryListing>(
    hostDirectoryQueryKey(longNamesMachine.id, null),
    {
      directory: longProjectPath,
      parent: "/home/winter",
      entries: [
        {
          kind: "directory",
          name: longFolderName,
          path: `${longProjectPath}/${longFolderName}`,
        },
        {
          kind: "file",
          name: longFileName,
          path: `${longProjectPath}/${longFileName}`,
        },
        {
          kind: "directory",
          name: "src",
          path: `${longProjectPath}/src`,
        },
      ],
    },
  );
  return queryClient;
}

export function Overview() {
  const queryClient = useMemo(() => createLongNamesQueryClient(), []);
  return (
    <StoryCard>
      <StoryRow
        label="create"
        hint='kind="create" — empty input; project-name preview appears once a path is typed'
      >
        <DialogStage>
          <ProjectPathDialogContent
            target={createTarget}
            pending={false}
            platform="darwin"
            hostId={null}
            hostName="Sawyer's MacBook"
            onSubmit={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="update"
        hint='kind="update" — prefilled with currentPath, submit reads "Save path"'
      >
        <DialogStage>
          <ProjectPathDialogContent
            target={updateTarget}
            pending={false}
            platform="darwin"
            hostId={null}
            hostName="Sawyer's MacBook"
            onSubmit={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="add-source"
        hint='kind="add-source" — empty input, submit reads "Add source"'
      >
        <DialogStage>
          <ProjectPathDialogContent
            target={addSourceTarget}
            pending={false}
            platform="darwin"
            hostId={null}
            hostName="Sawyer's MacBook"
            onSubmit={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="wsl"
        hint="WSL host — description hints at /mnt/c/... paths"
      >
        <DialogStage>
          <ProjectPathDialogContent
            target={createTarget}
            pending={false}
            platform="wsl"
            hostId={null}
            hostName="Sawyer's MacBook"
            onSubmit={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="unknown platform"
        hint="platform null — falls back to generic absolute-path copy"
      >
        <DialogStage>
          <ProjectPathDialogContent
            target={createTarget}
            pending={false}
            platform={null}
            hostId={null}
            hostName={null}
            onSubmit={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="machine picker"
        hint='kind="create" with several machines — offline rows are disabled; the folder browser below needs a live host, so it reads as empty here'
      >
        <DialogStage>
          <ProjectPathDialogContent
            target={createTarget}
            pending={false}
            platform="darwin"
            hostId={connectedMachine.id}
            hostName={connectedMachine.name}
            hosts={[connectedMachine, offlineMachine]}
            onSubmit={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="long names"
        hint="regression for #1112 — long folder, file, breadcrumb, and project names stay within the dialog"
      >
        <QueryClientProvider client={queryClient}>
          <DialogStage>
            <ProjectPathDialogContent
              target={createTarget}
              pending={false}
              platform="linux"
              hostId={longNamesMachine.id}
              hostName={longNamesMachine.name}
              hosts={[longNamesMachine, offlineMachine]}
              onSubmit={noop}
            />
          </DialogStage>
        </QueryClientProvider>
      </StoryRow>
      <StoryRow
        label="machines all offline"
        hint="no machine can be browsed — no row is selected and submit stays disabled"
      >
        <DialogStage>
          <ProjectPathDialogContent
            target={createTarget}
            pending={false}
            platform="darwin"
            hostId={null}
            hostName={null}
            hosts={[offlineLocalMachine, offlineMachine]}
            onSubmit={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="pending"
        hint="submit in flight — input + submit disabled"
      >
        <DialogStage>
          <ProjectPathDialogContent
            target={updateTarget}
            pending
            platform="darwin"
            hostId={null}
            hostName="Sawyer's MacBook"
            onSubmit={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
