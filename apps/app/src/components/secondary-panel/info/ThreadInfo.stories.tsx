import type { ReactNode } from "react";
import {
  makeEnvironment,
  makeHost,
  makeThreadListEntry,
  makeThreadWithRuntime,
} from "@bb/test-helpers/domain-fixtures";
import {
  REPRESENTATIVE_THREAD_INFO,
  SeededThreadInfo,
  type ThreadInfoFixture,
} from "@/test/fixtures/thread-info";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ThreadInfo } from "./ThreadInfo";

export default {
  title: "right-panel/Info/Thread info",
};

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[420px] w-full max-w-[480px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      {children}
    </div>
  );
}

function Scenario({
  fixture,
  threadId,
  environmentId,
}: {
  fixture: ThreadInfoFixture;
  threadId: string;
  environmentId: string | null;
}) {
  return (
    <Stage>
      <SeededThreadInfo
        fixture={fixture}
        threadId={threadId}
        environmentId={environmentId}
      >
        {(props) => <ThreadInfo {...props} />}
      </SeededThreadInfo>
    </Stage>
  );
}

const PROJECT_ID = REPRESENTATIVE_THREAD_INFO.projectId;

const REMOVED_MACHINE: ThreadInfoFixture = {
  projectId: PROJECT_ID,
  sidebarThreads: [
    makeThreadListEntry({
      id: "thr_removed",
      projectId: PROJECT_ID,
      environmentId: "env_removed",
    }),
  ],
  environments: [
    makeEnvironment({
      id: "env_removed",
      hostId: "host_gone",
      hostLifecycle: "removed",
    }),
  ],
  hosts: [makeHost({ id: "host_laptop", name: "Laptop" })],
  removedHosts: [
    makeHost({
      id: "host_gone",
      name: "Old cloud box",
      status: "disconnected",
    }),
  ],
};

const ARCHIVED: ThreadInfoFixture = {
  projectId: PROJECT_ID,
  sidebarThreads: [],
  fetchedThreads: [
    makeThreadWithRuntime({
      id: "thr_archived",
      projectId: PROJECT_ID,
      archivedAt: 1,
      environmentId: null,
    }),
  ],
};

const PENDING: ThreadInfoFixture = {
  projectId: PROJECT_ID,
  sidebarThreads: [
    makeThreadListEntry({
      id: "thr_pending",
      projectId: PROJECT_ID,
      status: "pending",
      environmentId: null,
    }),
  ],
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="child thread in a worktree"
        hint="Parent, Notify parent, Project, Environment with Machine (two machines), Directory, related threads and storage"
      >
        <Scenario
          fixture={REPRESENTATIVE_THREAD_INFO}
          threadId={REPRESENTATIVE_THREAD_INFO.threadId}
          environmentId={REPRESENTATIVE_THREAD_INFO.environmentId}
        />
      </StoryRow>
      <StoryRow
        label="removed machine"
        hint="The Machine row keeps the removed machine's name"
      >
        <Scenario
          fixture={REMOVED_MACHINE}
          threadId="thr_removed"
          environmentId="env_removed"
        />
      </StoryRow>
      <StoryRow label="archived" hint="Not in the sidebar; read by id">
        <Scenario
          fixture={ARCHIVED}
          threadId="thr_archived"
          environmentId={null}
        />
      </StoryRow>
      <StoryRow
        label="pending, no environment"
        hint="Core rows still show; plugin rows and sections would too"
      >
        <Scenario
          fixture={PENDING}
          threadId="thr_pending"
          environmentId={null}
        />
      </StoryRow>
    </StoryCard>
  );
}
