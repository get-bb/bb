import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { SidebarContent, SidebarProvider } from "@/components/ui/sidebar";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import {
  hostsQueryKey,
  sidebarNavigationQueryKey,
  systemProvidersQueryKey,
} from "@/hooks/queries/query-keys";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { createAppQueryClient } from "@/lib/query-client";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { loadPluginAppDefinition } from "../../../.ladle/plugin-app-module";
import {
  makeProject,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListReplacement } from "./threadListProvider";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { SidebarThreadEntriesProvider } from "@/lib/sidebar-thread-entries";
import codexLogoUrl from "../../../../../plugins/provider-codex/icons/codex.svg";
import claudeCodeLogoUrl from "../../../../../plugins/provider-claude-code/icons/claude-code.svg";

installTestPluginRuntime();
const threadListApp = await loadPluginAppDefinition(
  import.meta.glob<unknown>("../../../../../plugins/thread-list/app.tsx"),
);

export default { title: "sidebar/Thread list" };

const THREAD_LIST_PLUGIN_ID = "thread-list";
const WEB_PROJECT_ID = "proj_acme_web";
const NOW = 2_000_000;

type EntryOverrides = Parameters<typeof makeThreadListEntry>[0];
type ThreadEntry =
  SidebarBootstrapResponse["projects"][number]["threads"][number];

const RUNNING: EntryOverrides = {
  status: "active",
  runtime: { displayStatus: "active" },
};
const FAILED_UNREAD: EntryOverrides = { status: "error", lastReadAt: 0 };
const UNREAD: EntryOverrides = { lastReadAt: 0 };

let order = 0;
function entry(
  id: string,
  title: string,
  projectId: string,
  overrides: EntryOverrides = {},
): ThreadEntry {
  order += 1;
  const at = NOW - order * 1_000;
  return makeThreadListEntry({
    id,
    projectId,
    title,
    titleFallback: title,
    sectionId: null,
    environmentId: null,
    latestAttentionAt: at,
    createdAt: at,
    updatedAt: at,
    lastReadAt: at,
    providerId: "claude-code",
    ...overrides,
  });
}

function children(
  parentThreadId: string,
  projectId: string,
  titles: readonly (readonly [string, string, EntryOverrides?])[],
): ThreadEntry[] {
  return titles.map(([id, title, overrides]) =>
    entry(id, title, projectId, { parentThreadId, ...overrides }),
  );
}

const WEB_THREADS: ThreadEntry[] = [
  entry("thr_billing", "Migrate billing to Stripe webhooks", WEB_PROJECT_ID, {
    ...RUNNING,
    activity: { activeBackgroundCommandCount: 1 },
  }),
  ...children("thr_billing", WEB_PROJECT_ID, [
    ["thr_billing_a", "Audit the webhook handlers", RUNNING],
    ["thr_billing_b", "Port the retry logic", RUNNING],
    ["thr_billing_c", "Update the integration tests"],
    ["thr_billing_d", "Write the migration notes"],
  ]),
  entry("thr_react", "Upgrade the editor to React 19", WEB_PROJECT_ID, RUNNING),
  ...children("thr_react", WEB_PROJECT_ID, [
    ["thr_react_a", "List the class components"],
    ["thr_react_b", "Fix StrictMode warnings"],
    ["thr_react_c", "Bump testing-library"],
    ["thr_react_d", "Compare bundle sizes"],
  ]),
  entry("thr_flaky", "Fix the flaky checkout e2e test", WEB_PROJECT_ID, {
    ...FAILED_UNREAD,
    providerId: "codex",
  }),
  entry("thr_triage", "Triage open bug reports", WEB_PROJECT_ID),
  ...children("thr_triage", WEB_PROJECT_ID, [
    ["thr_triage_a", "Group duplicates by stack trace", RUNNING],
    ["thr_triage_b", "Reproduce the top crashers", RUNNING],
    ["thr_triage_c", "Label stale issues"],
  ]),
  entry("thr_notes", "Draft the 2.4 release notes", WEB_PROJECT_ID, UNREAD),
  entry("thr_a11y", "Accessibility audit across the app", WEB_PROJECT_ID),
  ...children("thr_a11y", WEB_PROJECT_ID, [
    ["thr_a11y_keyboard", "Keyboard navigation"],
    ["thr_a11y_labels", "Screen reader labels"],
    ["thr_a11y_contrast", "Color contrast"],
    ["thr_a11y_motion", "Reduced motion"],
  ]),
  ...children("thr_a11y_keyboard", WEB_PROJECT_ID, [
    ["thr_a11y_keyboard_a", "Tab order in dialogs"],
    ["thr_a11y_keyboard_b", "Focus traps"],
    ["thr_a11y_keyboard_c", "Skip links"],
  ]),
  ...children("thr_a11y_labels", WEB_PROJECT_ID, [
    ["thr_a11y_labels_a", "Icon-only buttons"],
    ["thr_a11y_labels_b", "Form errors"],
  ]),
  ...children("thr_a11y_contrast", WEB_PROJECT_ID, [
    ["thr_a11y_contrast_a", "Dark theme tokens"],
    ["thr_a11y_contrast_b", "Disabled states"],
    ["thr_a11y_contrast_c", "Charts"],
    ["thr_a11y_contrast_d", "Links in body text"],
  ]),
  entry(
    "thr_ratelimit",
    "Add rate limiting to the public API",
    WEB_PROJECT_ID,
    {
      providerId: "codex",
    },
  ),
];

const PERSONAL_THREADS: ThreadEntry[] = [
  entry("thr_roadmap", "Plan the Q4 roadmap", PERSONAL_PROJECT_ID, RUNNING),
  ...children("thr_roadmap", PERSONAL_PROJECT_ID, [
    ["thr_roadmap_a", "Summarize the user interviews"],
    ["thr_roadmap_b", "Compare competitor pricing"],
  ]),
  entry(
    "thr_onboarding",
    "Redesign the onboarding flow",
    PERSONAL_PROJECT_ID,
    RUNNING,
  ),
  ...children("thr_onboarding", PERSONAL_PROJECT_ID, [
    ["thr_onboarding_a", "Map the current funnel", RUNNING],
    ["thr_onboarding_b", "Benchmark competitor onboarding"],
    ["thr_onboarding_c", "Synthesize the interview notes"],
    ["thr_onboarding_d", "Wireframe the welcome screen"],
    ["thr_onboarding_e", "Write the empty-state copy"],
    ["thr_onboarding_f", "Measure time to first value"],
    ["thr_onboarding_g", "Instrument drop-off events"],
    ["thr_onboarding_h", "Accessibility pass on forms", FAILED_UNREAD],
    ["thr_onboarding_i", "Localize the onboarding copy", FAILED_UNREAD],
    ["thr_onboarding_j", "Screenshot every step", FAILED_UNREAD],
  ]),
  entry("thr_deps", "Weekly dependency updates", PERSONAL_PROJECT_ID),
];

const ALL_THREADS = [...WEB_THREADS, ...PERSONAL_THREADS];

function descendantIds(threadId: string): string[] {
  return ALL_THREADS.filter(
    (thread) => thread.parentThreadId === threadId,
  ).flatMap((thread) => [thread.id, ...descendantIds(thread.id)]);
}

function navigation(archived: ReadonlySet<string>): SidebarBootstrapResponse {
  const visible = (threads: ThreadEntry[]) =>
    threads.filter((thread) => !archived.has(thread.id));
  return {
    sections: [],
    projects: [
      {
        ...makeProject({ id: WEB_PROJECT_ID, name: "acme-web" }),
        defaultExecutionOptions: null,
        threads: visible(WEB_THREADS),
      },
    ],
    personalProject: {
      ...makeProject({
        id: PERSONAL_PROJECT_ID,
        kind: "personal",
        name: "Personal",
        sources: [],
      }),
      defaultExecutionOptions: null,
      threads: visible(PERSONAL_THREADS),
    },
  };
}

const STORY_PROVIDERS = [
  makeProviderInfo({
    id: "claude-code",
    displayName: "Claude Code",
    logoUrl: claudeCodeLogoUrl,
  }),
  makeProviderInfo({
    id: "codex",
    displayName: "Codex",
    logoUrl: codexLogoUrl,
  }),
];

const PREFERENCES = {
  organizationMode: "project",
  groupByReadStatus: false,
  collapsedThreads: [
    "thr_billing",
    "thr_react",
    "thr_triage",
    "thr_a11y",
    "thr_onboarding",
  ],
};

function createSubThreadQueryClient() {
  const queryClient = createAppQueryClient({
    showMutationErrorToasts: false,
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
    },
  });
  queryClient.setQueryData(hostsQueryKey(), []);
  queryClient.setQueryData(sidebarNavigationQueryKey(), navigation(new Set()));
  queryClient.setQueryData(systemProvidersQueryKey(), STORY_PROVIDERS);
  return queryClient;
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function useMockServer(showProviderIcons: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const preferences: Record<string, unknown> = {
      ...PREFERENCES,
      showProviderIcons,
    };
    const archived = new Set<string>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(url, globalThis.location.href).pathname;
      const rpc = path.match(
        new RegExp(`/api/v1/plugins/${THREAD_LIST_PLUGIN_ID}/rpc/([^/]+)$`),
      )?.[1];
      if (rpc === "listPreferences") {
        return json({ ok: true, result: { preferences } });
      }
      if (rpc === "setPreference" && typeof init?.body === "string") {
        const { key, value } = JSON.parse(init.body) as {
          key: string;
          value: unknown;
        };
        preferences[key] = value;
        return json({ ok: true, result: { key, value } });
      }
      if (path.endsWith("/api/v1/sidebar-bootstrap")) {
        return json(navigation(archived));
      }
      const summaryId = path.match(
        /\/api\/v1\/threads\/([^/]+)\/child-summary$/,
      )?.[1];
      if (summaryId !== undefined) {
        const descendants = descendantIds(summaryId).filter(
          (id) => !archived.has(id),
        );
        return json({
          nonDeletedChildCount: ALL_THREADS.filter(
            (thread) => thread.parentThreadId === summaryId,
          ).length,
          unarchivedDescendantCount: descendants.length,
        });
      }
      const archiveId = path.match(
        /\/api\/v1\/threads\/([^/]+)\/archive-all$/,
      )?.[1];
      if (archiveId !== undefined) {
        const ids = [archiveId, ...descendantIds(archiveId)].filter(
          (id) => !archived.has(id),
        );
        for (const id of ids) archived.add(id);
        return json({ ok: true, archivedThreadIds: ids });
      }
      const unarchiveId = path.match(
        /\/api\/v1\/threads\/([^/]+)\/unarchive$/,
      )?.[1];
      if (unarchiveId !== undefined) {
        archived.delete(unarchiveId);
        return json({ ok: true });
      }
      return originalFetch(input, init);
    };
    setReady(true);
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [showProviderIcons]);
  return ready;
}

function useThreadListPlugin() {
  useEffect(() => {
    setPluginSlotRegistrations(
      THREAD_LIST_PLUGIN_ID,
      makePluginRegistrationSet({
        threadLists: collectPluginAppRegistrations(threadListApp).threadLists,
      }),
    );
    return () => removePluginSlotRegistrations(THREAD_LIST_PLUGIN_ID);
  }, []);
}

function SubThreadSidebar() {
  const replacement = useThreadListReplacement();
  const { data } = useSidebarNavigation();
  return (
    <SidebarThreadEntriesProvider navigation={data}>
      <SidebarProvider defaultOpen className="min-h-0 w-auto">
        <div className="flex h-[680px] w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-sidebar-border bg-sidebar text-sidebar-foreground">
          <SidebarContent>
            <PluginThreadList replacement={replacement} onNavigate={() => {}} />
          </SidebarContent>
        </div>
      </SidebarProvider>
    </SidebarThreadEntriesProvider>
  );
}

function SubThreadStory({ showProviderIcons }: { showProviderIcons: boolean }) {
  const [queryClient] = useState(createSubThreadQueryClient);
  const ready = useMockServer(showProviderIcons);
  useThreadListPlugin();
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThreadActionsProvider>
        <main className="flex gap-6 p-6">
          <SubThreadSidebar />
          <section className="grid max-w-xs content-start gap-3 text-sm text-muted-foreground">
            {showProviderIcons ? (
              <p>
                Hover a parent row: its icon turns into the chevron that expands
                its sub-threads, and Archive sits where it does on every other
                row.
              </p>
            ) : (
              <p>
                Without provider icons, a parent's chevron leads its title
                inside the row, and every other row keeps the same slot, so
                titles line up. Sub-thread guides run down from the chevron.
              </p>
            )}
            <p>
              The number after a title counts sub-threads, or shows busy/total
              while some run.
            </p>
          </section>
        </main>
      </ThreadActionsProvider>
    </QueryClientProvider>
  );
}

export function SubThreads() {
  return <SubThreadStory showProviderIcons />;
}

export function SubThreadsWithoutProviderIcons() {
  return <SubThreadStory showProviderIcons={false} />;
}
