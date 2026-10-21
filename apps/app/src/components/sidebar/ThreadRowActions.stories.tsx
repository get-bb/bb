import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { PluginContext } from "@/components/plugin/plugin-context";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarThreadEntriesProvider } from "@/lib/sidebar-thread-entries";
import { createAppQueryClient } from "@/lib/query-client";
import {
  systemConfigQueryKey,
  hostsQueryKey,
  sidebarNavigationQueryKey,
} from "@/hooks/queries/query-keys";
import {
  makeProject,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import {
  ThreadRow,
  SidebarProvidersContext,
} from "../../../../../plugins/thread-list/app/rows/ThreadRow";
import { SidebarRenameProvider } from "../../../../../plugins/thread-list/app/rows/SidebarInlineRename";
import { ThreadRowNavigationProvider } from "../../../../../plugins/thread-list/app/rows/threadRowNavigation";
import { makeSidebarThread } from "../../../../../plugins/thread-list/app/model/fixtures";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "../../../../../plugins/thread-list/app/model/thread-activity";

export default { title: "sidebar/Thread row actions" };

const FIXTURES = [
  {
    id: "leaf-short",
    title: "Plan",
    parent: false,
    collapsed: false,
    depth: 0,
  },
  {
    id: "leaf-long",
    title: "Migrate billing to webhooks and improve retry handling",
    parent: false,
    collapsed: false,
    depth: 0,
  },
  {
    id: "short-collapsed",
    title: "Plan",
    parent: true,
    collapsed: true,
    depth: 0,
  },
  {
    id: "short-expanded",
    title: "Plan",
    parent: true,
    collapsed: false,
    depth: 0,
  },
  {
    id: "medium-collapsed",
    title: "Triage open bug reports",
    parent: true,
    collapsed: true,
    depth: 0,
  },
  {
    id: "medium-expanded",
    title: "Triage open bug reports",
    parent: true,
    collapsed: false,
    depth: 0,
  },
  {
    id: "long-collapsed",
    title: "Migrate billing to webhooks and improve retry handling",
    parent: true,
    collapsed: true,
    depth: 0,
  },
  {
    id: "long-expanded",
    title: "Migrate billing to webhooks and improve retry handling",
    parent: true,
    collapsed: false,
    depth: 0,
  },
  {
    id: "sub-thread",
    title: "Check retry handling",
    parent: false,
    collapsed: false,
    depth: 1,
  },
];
const ENTRIES = FIXTURES.map((fixture) =>
  makeThreadListEntry({
    id: fixture.id,
    title: fixture.title,
    titleFallback: fixture.title,
    lastReadAt: 0,
    latestAttentionAt: 1,
  }),
);
const NAVIGATION = {
  sections: [],
  projects: [
    { ...makeProject(), defaultExecutionOptions: null, threads: ENTRIES },
  ],
  personalProject: {
    ...makeProject({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      sources: [],
    }),
    defaultExecutionOptions: null,
    threads: [],
  },
};
const PROVIDERS = [
  makeProviderInfo({
    id: "provider-example",
    displayName: "Example agent",
    icon: { glyph: "Bot" },
    logoUrl: null,
  }),
];

export function Overview() {
  const [queryClient] = useState(() => {
    const client = createAppQueryClient({
      showMutationErrorToasts: false,
      defaultOptions: {
        queries: { staleTime: Infinity, retry: false, enabled: false },
        mutations: { retry: false },
      },
    });
    client.setQueryData(systemConfigQueryKey(), makeSystemConfig());
    client.setQueryData(hostsQueryKey(), []);
    client.setQueryData(sidebarNavigationQueryKey(), NAVIGATION);
    return client;
  });
  const [collapsed, setCollapsed] = useState(
    Object.fromEntries(FIXTURES.map((f) => [f.id, f.collapsed])),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SidebarThreadEntriesProvider navigation={NAVIGATION}>
        <ThreadActionsProvider>
          <PluginContext.Provider value="thread-list">
            <SidebarProvidersContext.Provider value={PROVIDERS}>
              <ThreadRowNavigationProvider>
                <SidebarRenameProvider>
                  <SidebarProvider defaultOpen className="min-h-0 w-auto">
                    <main
                      data-thread-row-fixture
                      className="bg-sidebar text-sidebar-foreground"
                      style={{ width: 288, padding: "12px 8px" }}
                    >
                      <div className="mb-3 px-2 text-xs text-muted-foreground">
                        Threads
                      </div>
                      {FIXTURES.map((fixture) => (
                        <div key={fixture.id} data-fixture={fixture.id}>
                          <ThreadRow
                            thread={makeSidebarThread({
                              id: fixture.id,
                              title: fixture.title,
                              providerId: "provider-example",
                              isUnread: true,
                              parentThreadId: fixture.depth
                                ? "long-expanded"
                                : null,
                            })}
                            crossProjectId={null}
                            isActive={false}
                            options={
                              fixture.parent
                                ? {
                                    kind: "parent",
                                    depth: fixture.depth,
                                    isCompact: false,
                                    isCollapsed: collapsed[fixture.id],
                                    childCount: 2,
                                    childActivity: NO_COLLAPSED_CHILD_ACTIVITY,
                                    onToggleCollapsed: (id) =>
                                      setCollapsed((current) => ({
                                        ...current,
                                        [id]: !current[id],
                                      })),
                                  }
                                : {
                                    kind: "default",
                                    depth: fixture.depth,
                                    isCompact: false,
                                  }
                            }
                          />
                        </div>
                      ))}
                    </main>
                  </SidebarProvider>
                </SidebarRenameProvider>
              </ThreadRowNavigationProvider>
            </SidebarProvidersContext.Provider>
          </PluginContext.Provider>
        </ThreadActionsProvider>
      </SidebarThreadEntriesProvider>
    </QueryClientProvider>
  );
}
