import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import type {
  Environment,
  Host,
  ThreadListEntry,
  ThreadWithRuntime,
} from "@bb/domain";
import type {
  SystemEnvironmentProvider,
  SystemMachineProvider,
  WorkspaceFile,
} from "@bb/server-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  makeEnvironment,
  makeHost,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import { ThreadInfo } from "@/components/secondary-panel/info/ThreadInfo";
import { TabVisibleContext } from "@/components/secondary-panel/tab-visibility";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { systemEnvironmentProvidersQueryKey } from "@/hooks/queries/environment-provider-queries";
import {
  environmentQueryKey,
  hostsQueryKey,
  removedHostQueryKey,
  systemMachineProvidersQueryKey,
  threadQueryKey,
  threadStorageFilesQueryKey,
} from "@/hooks/queries/query-keys";
import { addSidebarThreads } from "@/test/fixtures/related-threads";

export interface ThreadInfoFixture {
  projectId: string;
  sidebarThreads: readonly ThreadListEntry[];
  fetchedThreads?: readonly ThreadWithRuntime[];
  environments?: readonly Environment[];
  hosts?: readonly Host[];
  removedHosts?: readonly Host[];
  environmentProviders?: readonly SystemEnvironmentProvider[];
  machineProviders?: readonly SystemMachineProvider[];
  storageFiles?: Readonly<Record<string, readonly WorkspaceFile[]>>;
}

export function createThreadInfoQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
}

export function seedThreadInfo(
  queryClient: QueryClient,
  fixture: ThreadInfoFixture,
): void {
  addSidebarThreads(queryClient, fixture.projectId, fixture.sidebarThreads);
  for (const thread of fixture.fetchedThreads ?? []) {
    queryClient.setQueryData(threadQueryKey(thread.id), thread);
  }
  for (const environment of fixture.environments ?? []) {
    queryClient.setQueryData(environmentQueryKey(environment.id), environment);
  }
  queryClient.setQueryData(hostsQueryKey(), fixture.hosts ?? []);
  for (const host of fixture.removedHosts ?? []) {
    queryClient.setQueryData(removedHostQueryKey(host.id), {
      ...host,
      connectMachineId: null,
      threadStorageRootPath: null,
    });
  }
  queryClient.setQueryData(
    systemEnvironmentProvidersQueryKey({}),
    fixture.environmentProviders ?? [],
  );
  queryClient.setQueryData(
    systemMachineProvidersQueryKey(),
    fixture.machineProviders ?? [],
  );
  for (const [threadId, files] of Object.entries(fixture.storageFiles ?? {})) {
    queryClient.setQueryData(threadStorageFilesQueryKey(threadId), {
      files,
      truncated: false,
    });
  }
}

export function ThreadInfoFixtureProvider({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ThreadActionsProvider>
            <TooltipProvider>
              <TabVisibleContext.Provider value>
                {children}
              </TabVisibleContext.Provider>
            </TooltipProvider>
          </ThreadActionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

const STORY_PROJECT_ID = "proj_bb";
const STORY_THREAD_ID = "thr_story";

function storyFile(path: string): WorkspaceFile {
  return { path, name: path.slice(path.lastIndexOf("/") + 1) };
}

export const REPRESENTATIVE_THREAD_INFO: ThreadInfoFixture & {
  threadId: string;
  environmentId: string;
} = {
  projectId: STORY_PROJECT_ID,
  threadId: STORY_THREAD_ID,
  environmentId: "env_story",
  sidebarThreads: [
    makeThreadListEntry({
      id: "thr_story_parent",
      projectId: STORY_PROJECT_ID,
      title: "Ship the Info tab on public rows",
    }),
    makeThreadListEntry({
      id: STORY_THREAD_ID,
      projectId: STORY_PROJECT_ID,
      title: "Move the environment rows",
      environmentId: "env_story",
      parentThreadId: "thr_story_parent",
      parentNotifications: "stuck",
    }),
    makeThreadListEntry({
      id: "thr_story_child",
      projectId: STORY_PROJECT_ID,
      title: "Check removed machines live",
      parentThreadId: STORY_THREAD_ID,
      updatedAt: 1_800_000_000_000,
    }),
    makeThreadListEntry({
      id: "thr_story_fork",
      projectId: STORY_PROJECT_ID,
      title: "Try a host-owned label",
      sourceThreadId: STORY_THREAD_ID,
      originKind: "fork",
      updatedAt: 1_800_000_000_000,
    }),
  ],
  environments: [
    makeEnvironment({
      id: "env_story",
      hostId: "host_studio",
      path: "/Users/dev/.bb/worktrees/bb-info-tab",
      environmentProviderId: "git-worktree",
    }),
  ],
  hosts: [
    makeHost({ id: "host_laptop", name: "Laptop" }),
    makeHost({ id: "host_studio", name: "Studio" }),
  ],
  environmentProviders: [],
  storageFiles: {
    [STORY_THREAD_ID]: [
      storyFile("notes/current-work.md"),
      storyFile("notes/archive/2026-09.md"),
      storyFile("plans/kickoff.md"),
      storyFile("qa/screenshots/after/info-panel.png"),
      storyFile("reports/status.md"),
      storyFile("handoff.md"),
    ],
  },
};

export function SeededThreadInfo({
  fixture,
  threadId,
  environmentId,
  children,
}: {
  fixture: ThreadInfoFixture;
  threadId: string;
  environmentId: string | null;
  children: (props: {
    threadId: string;
    environment: { id: string } | null;
  }) => ReactNode;
}) {
  const [queryClient] = useState(() => {
    const client = createThreadInfoQueryClient();
    seedThreadInfo(client, fixture);
    return client;
  });
  return (
    <ThreadInfoFixtureProvider queryClient={queryClient}>
      {children({
        threadId,
        environment: environmentId === null ? null : { id: environmentId },
      })}
    </ThreadInfoFixtureProvider>
  );
}

export function RepresentativeThreadInfo() {
  return (
    <SeededThreadInfo
      fixture={REPRESENTATIVE_THREAD_INFO}
      threadId={REPRESENTATIVE_THREAD_INFO.threadId}
      environmentId={REPRESENTATIVE_THREAD_INFO.environmentId}
    >
      {(props) => <ThreadInfo {...props} />}
    </SeededThreadInfo>
  );
}
