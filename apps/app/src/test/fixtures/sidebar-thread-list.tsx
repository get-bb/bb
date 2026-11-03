import { resolve } from "node:path";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createStore, Provider as JotaiProvider } from "jotai";
import { vi } from "vitest";
import {
  defaultUiPreferences,
  PERSONAL_PROJECT_ID,
  UI_PREFERENCE_KEYS,
  type ThreadListEntry,
  type ThreadStatus,
} from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import {
  makeHost,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import { makeProjectWithThreadsResponse } from "@/test/fixtures/projects";
import {
  hostsQueryKey,
  sidebarNavigationQueryKey,
  uiPreferencesQueryKey,
} from "@/hooks/queries/query-keys";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { isPluginAppDefinition } from "@/lib/plugin-app-definition";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  setPluginSlotRegistrations,
  type PluginThreadListSlot,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { SidebarThreadEntriesTestProvider } from "@/test/sidebarThreadEntriesTestProvider";

const PROJECT_COUNT = 40;
const SECTION_COUNT = 8;
const STATUSES: ThreadStatus[] = ["idle", "active", "idle", "idle", "error"];

interface PluginRpcReply {
  result: unknown;
  keyTags?: Record<string, string[]>;
}

export function stubPluginRpcFetch(
  reply: (method: string, body: string) => PluginRpcReply,
): void {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("/rpc/")) {
        return new Response("{}", { status: 404 });
      }
      const { result, keyTags = {} } = reply(
        url.split("/rpc/")[1] ?? "",
        String(init?.body ?? "{}"),
      );
      return new Response(JSON.stringify({ ok: true, result, keyTags }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
}

async function loadPluginAppThreadActions(pluginId: string) {
  installPluginRuntime();
  const module: { default?: unknown } = await import(
    /* @vite-ignore */ resolve(
      __dirname,
      `../../../../../plugins/${pluginId}/app.tsx`,
    )
  );
  if (!isPluginAppDefinition(module.default)) {
    throw new Error(`${pluginId}'s app.tsx exports no plugin app definition`);
  }
  const collected = collectPluginAppRegistrations(module.default);
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({ threadActions: collected.threadActions }),
  );
  return collected;
}

export async function loadPluginThreadListReplacement({
  withNotifications,
}: {
  withNotifications: boolean;
}): Promise<ResolvedReplacement<PluginThreadListSlot>> {
  if (withNotifications) {
    await loadPluginAppThreadActions("push-notifications");
  }
  const collected = await loadPluginAppThreadActions("thread-list");
  const registration = collected.threadLists[0];
  if (registration === undefined) {
    throw new Error("thread-list plugin registered no thread list");
  }
  return {
    kind: "plugin",
    registration: { ...registration, pluginId: "thread-list", generation: 1 },
  };
}

function buildBootstrap(threadCount: number): SidebarBootstrapResponse {
  const sections = Array.from({ length: SECTION_COUNT }, (_, index) => ({
    id: `sec_${index}`,
    name: `Section ${index}`,
    createdAt: index,
    updatedAt: index,
  }));
  const projects = Array.from({ length: PROJECT_COUNT }, (_, index) =>
    makeProjectWithThreadsResponse({
      id: `proj_${index}`,
      name: `Project ${index}`,
      threads: [],
    }),
  );
  const personalProject = makeProjectWithThreadsResponse({
    id: PERSONAL_PROJECT_ID,
    name: "Personal",
    threads: [],
  });
  const roots: ThreadListEntry[] = [];
  for (let index = 0; index < threadCount; index += 1) {
    const projectIndex = index % (PROJECT_COUNT + 1);
    const project =
      projectIndex === PROJECT_COUNT
        ? personalProject
        : projects[projectIndex]!;
    const isChild = index % 10 === 9 && roots.length > 0;
    const parent = isChild ? roots[roots.length - 1]! : null;
    const status = STATUSES[index % STATUSES.length]!;
    const thread = makeThreadListEntry({
      id: `thr_${index}`,
      projectId: parent?.projectId ?? project.id,
      title: `Thread ${index} about @project:${project.id}`,
      titleFallback: `Thread ${index}`,
      parentThreadId: parent?.id ?? null,
      sectionId:
        parent === null && index % 2 === 0
          ? `sec_${index % SECTION_COUNT}`
          : null,
      pinnedAt: parent === null && index % 150 === 0 ? 1_000 + index : null,
      status,
      runtime: { displayStatus: status },
      createdAt: 1_000_000 - index,
      updatedAt: 2_000_000 - index,
      latestAttentionAt: 2_000_000 - index,
      lastReadAt: index % 3 === 0 ? null : 3_000_000,
      environmentId: `env_${index % 200}`,
      environmentHostId: "host_test",
      environmentName: `env ${index % 200}`,
      environmentBranchName: `feature/${index % 200}`,
      environmentIsWorktree: index % 4 !== 0,
      environmentWorkspaceDisplayKind:
        index % 4 !== 0 ? "managed-worktree" : "other",
    });
    if (parent === null) roots.push(thread);
    const target =
      thread.projectId === PERSONAL_PROJECT_ID
        ? personalProject
        : projects.find((candidate) => candidate.id === thread.projectId)!;
    target.threads.push(thread);
  }
  return { sections, projects, personalProject };
}

export function seedSidebarQueryClient(threadCount: number): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    buildBootstrap(threadCount),
  );
  queryClient.setQueryData(uiPreferencesQueryKey(), {
    preferences: Object.fromEntries(
      UI_PREFERENCE_KEYS.map((key) => [
        key,
        { revision: 1, value: defaultUiPreferences[key] },
      ]),
    ),
  });
  queryClient.setQueryData(hostsQueryKey(false), [
    makeHost({ id: "host_test", name: "bee" }),
  ]);
  return queryClient;
}

export function SidebarThreadListHarness({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <TooltipProvider>
      <JotaiProvider store={createStore()}>
        <QueryClientProvider client={queryClient}>
          <SidebarThreadEntriesTestProvider>
            <MemoryRouter>
              <SidebarProvider>
                <Sidebar>
                  <SidebarContent>{children}</SidebarContent>
                </Sidebar>
              </SidebarProvider>
            </MemoryRouter>
          </SidebarThreadEntriesTestProvider>
        </QueryClientProvider>
      </JotaiProvider>
    </TooltipProvider>
  );
}
