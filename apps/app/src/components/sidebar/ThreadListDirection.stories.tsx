import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useStore } from "jotai";
import { useLocation, useNavigate } from "react-router-dom";
import {
  PERSONAL_PROJECT_ID,
  defaultUiPreferences,
  type AppKeybinding,
  type ThreadListEntry,
} from "@bb/domain";
import {
  createProjectRequestSchema,
  createThreadSectionRequestSchema,
  updateThreadSectionRequestSchema,
  deleteThreadSectionRequestSchema,
  type SidebarBootstrapResponse,
  type ThreadSectionResponse,
} from "@bb/server-contract";
import {
  makeHost,
  makeProject,
  makeThreadListEntry,
  STORY_ENVIRONMENT_PROVIDERS,
} from "../../../.ladle/story-fixtures";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import {
  hostsQueryKey,
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
  threadQueryKey,
  uiPreferencesQueryKey,
} from "@/hooks/queries/query-keys";
import { systemEnvironmentProvidersQueryKey } from "@/hooks/queries/environment-provider-queries";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
  usePluginFrontendsSettled,
} from "@/lib/plugin-frontend-boot-state";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "@/components/plugin/pluginNavSidebarAtoms";
import {
  AppCommandProvider,
  useAppCommandHandler,
} from "@/components/commands/AppCommandProvider";
import { BuiltInSidebarNavigation } from "./BuiltInSidebarNavigation";
import { TOOLS_ROUTE_PATH } from "@/lib/route-paths";
import { useQuickCreateProject } from "@/hooks/useQuickCreateProject";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import { ProjectList } from "./ProjectList";
import {
  sidebarOrganizationModeAtom,
  sidebarChronologicalSortAtom,
  sidebarSortDirectionAtom,
  collapsedThreadIdsAtom,
  collapsedEnvironmentIdsAtom,
  collapsedProjectIdsAtom,
  collapsedSidebarSectionIdsAtom,
} from "./sidebarCollapsedAtoms";

export default { title: "Sidebar/Thread list controls" };
const STORY_NAVIGATION_PLUGIN_ID = "thread-list-story-doctrine";
const STORY_HOST = makeHost({ name: "MacBook Pro" });
const STORY_SECOND_HOST = makeHost({
  id: "host_thread_list_mac_mini",
  name: "Mac mini",
});
const STORY_SEARCH_KEYBINDING = {
  command: "thread.search",
  desktopOnly: false,
  shortcut: {
    key: "k",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  },
  when: { all: [], none: [] },
} satisfies AppKeybinding;

const CURRENT_ATLAS_PROJECT = makeProject({
  id: "proj_thread_list_atlas",
  name: "Atlas",
});

const CURRENT_MOBILE_PROJECT = makeProject({
  id: "proj_thread_list_mobile",
  name: "Mobile",
});

const CURRENT_PERSONAL_PROJECT = makeProject({
  id: PERSONAL_PROJECT_ID,
  kind: "personal",
  name: "Personal",
});

const CURRENT_COMPARISON_NAVIGATION = {
  sections: [
    {
      id: "section_thread_list_review",
      name: "Review",
      createdAt: 100,
      updatedAt: 100,
    },
  ],
  personalProject: {
    ...CURRENT_PERSONAL_PROJECT,
    defaultExecutionOptions: null,
    threads: [
      makeThreadListEntry({
        id: "thr_thread_list_loose",
        sectionId: "section_thread_list_review",
        projectId: PERSONAL_PROJECT_ID,
        environmentHostId: STORY_HOST.id,
        title: "Prepare release handoff",
        titleFallback: "Prepare release handoff",
        latestAttentionAt: 130,
        lastReadAt: 130,
        updatedAt: 130,
      }),
      makeThreadListEntry({
        id: "thr_thread_list_draft",
        projectId: PERSONAL_PROJECT_ID,
        environmentHostId: STORY_HOST.id,
        title: "Draft palette copy",
        titleFallback: "Draft palette copy",
        hasPendingInteraction: true,
        latestAttentionAt: 120,
        lastReadAt: 120,
        updatedAt: 120,
      }),
    ],
  },
  projects: [
    {
      ...CURRENT_ATLAS_PROJECT,
      defaultExecutionOptions: null,
      threads: [
        makeThreadListEntry({
          id: "thr_thread_list_pinned",
          projectId: CURRENT_ATLAS_PROJECT.id,
          environmentHostId: STORY_HOST.id,
          title: "Review thread-list direction",
          titleFallback: "Review thread-list direction",
          pinnedAt: 220,
          pinSortKey: "0001",
          status: "active",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
          latestAttentionAt: 220,
          lastReadAt: 220,
          updatedAt: 220,
        }),
        makeThreadListEntry({
          id: "thr_thread_list_parent",
          createdAt: 50,
          projectId: CURRENT_ATLAS_PROJECT.id,
          environmentHostId: STORY_HOST.id,
          title: "Confirm archive placement",
          titleFallback: "Confirm archive placement",
          latestAttentionAt: 210,
          lastReadAt: 210,
          updatedAt: 210,
        }),
        makeThreadListEntry({
          id: "thr_thread_list_nested",
          projectId: CURRENT_ATLAS_PROJECT.id,
          environmentHostId: STORY_HOST.id,
          parentThreadId: "thr_thread_list_parent",
          title: "Verify nested status rollup",
          titleFallback: "Verify nested status rollup",
          latestAttentionAt: 205,
          lastReadAt: 100,
          updatedAt: 205,
        }),
        makeThreadListEntry({
          id: "thr_thread_list_worktree",
          createdAt: 70,
          projectId: CURRENT_ATLAS_PROJECT.id,
          environmentHostId: STORY_HOST.id,
          environmentId: "env_thread_list_qa",
          environmentProviderId: "git-worktree",
          environmentName: "QA worktree",
          environmentBranchName: "feat/thread-list-direction",
          environmentIsWorktree: true,
          environmentWorkspaceDisplayKind: "managed-worktree",
          title: "Verify compact sidebar spacing",
          titleFallback: "Verify compact sidebar spacing",
          latestAttentionAt: 200,
          lastReadAt: 200,
          updatedAt: 200,
        }),
        makeThreadListEntry({
          id: "thr_thread_list_worktree_review",
          projectId: CURRENT_ATLAS_PROJECT.id,
          environmentHostId: STORY_HOST.id,
          environmentId: "env_thread_list_qa",
          environmentProviderId: "git-worktree",
          environmentName: "QA worktree",
          environmentBranchName: "feat/thread-list-direction",
          environmentIsWorktree: true,
          environmentWorkspaceDisplayKind: "managed-worktree",
          title: "Review worktree changes",
          titleFallback: "Review worktree changes",
          hasPendingInteraction: true,
          latestAttentionAt: 195,
          lastReadAt: 195,
          updatedAt: 195,
        }),
      ],
    },
    {
      ...CURRENT_MOBILE_PROJECT,
      defaultExecutionOptions: null,
      threads: [
        makeThreadListEntry({
          id: "thr_thread_list_mobile_review",
          createdAt: 10,
          projectId: CURRENT_MOBILE_PROJECT.id,
          environmentHostId: STORY_SECOND_HOST.id,
          title: "Responsive sidebar review",
          titleFallback: "Responsive sidebar review",
          latestAttentionAt: 190,
          lastReadAt: 100,
          updatedAt: 190,
        }),
        makeThreadListEntry({
          id: "thr_thread_list_mobile_performance",
          projectId: CURRENT_MOBILE_PROJECT.id,
          environmentHostId: STORY_SECOND_HOST.id,
          title: "Mobile drawer performance",
          titleFallback: "Mobile drawer performance",
          latestAttentionAt: 180,
          lastReadAt: 180,
          updatedAt: 180,
        }),
      ],
    },
  ],
} satisfies SidebarBootstrapResponse;

function SidebarChrome() {
  useAppCommandHandler("thread.search", () => true);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (!ready) return null;

  return (
    <BuiltInSidebarNavigation
      onNewChat={() => {}}
      toolsRoutePath={TOOLS_ROUTE_PATH}
    />
  );
}

function ThreadListStoryFixture({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const store = useStore();
  const navigate = useRef(useNavigate());
  const initialLocation = useRef(useLocation());
  const initiallySettled = useRef(usePluginFrontendsSettled());
  const [organizationMode, setOrganizationMode] = useAtom(
    sidebarOrganizationModeAtom,
  );
  const initialOrganizationMode = useRef(organizationMode);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const queryFixtures = [
      {
        queryKey: sidebarNavigationQueryKey(),
        data: CURRENT_COMPARISON_NAVIGATION,
      },
      {
        queryKey: uiPreferencesQueryKey(),
        data: {
          preferences: Object.fromEntries(
            Object.entries(defaultUiPreferences).map(([key, value]) => [
              key,
              { revision: 0, value },
            ]),
          ),
        },
      },
      {
        queryKey: systemEnvironmentProvidersQueryKey({}),
        data: STORY_ENVIRONMENT_PROVIDERS,
      },
      { queryKey: hostsQueryKey(), data: [STORY_HOST, STORY_SECOND_HOST] },
      {
        queryKey: systemConfigQueryKey(),
        data: makeSystemConfig({
          keybindings: [STORY_SEARCH_KEYBINDING],
          defaultKeybindings: [STORY_SEARCH_KEYBINDING],
        }),
      },
    ];
    const previousQueries = queryFixtures.map(({ queryKey, data }) => {
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, data);
      return { queryKey, previous };
    });
    const previousThreadQueries = ALL_STORY_THREADS.map(({ id }) => {
      const queryKey = threadQueryKey(id);
      return { queryKey, previous: queryClient.getQueryData(queryKey) };
    });
    const originalFetch = globalThis.fetch;
    const fixtureFetch: typeof fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        window.location.origin,
      );
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const navigation = queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      );
      if (url.origin === window.location.origin && navigation) {
        if (method === "GET" && url.pathname === "/api/v1/sidebar-bootstrap")
          return Response.json(navigation);
        if (method === "POST" && url.pathname === "/api/v1/projects") {
          const request = createProjectRequestSchema.parse(
            await new Request(
              input instanceof Request ? input : url,
              init,
            ).json(),
          );
          const timestamp = Date.now();
          const projectId = `proj_story_${crypto.randomUUID()}`;
          const project = makeProject({
            id: projectId,
            name: request.name,
            sources: [
              {
                ...request.source,
                id: `source_story_${crypto.randomUUID()}`,
                projectId,
                isDefault: true,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
          });
          queryClient.setQueryData<SidebarBootstrapResponse>(
            sidebarNavigationQueryKey(),
            {
              ...navigation,
              projects: [
                ...navigation.projects,
                { ...project, defaultExecutionOptions: null, threads: [] },
              ],
            },
          );
          return Response.json(project);
        }
        if (
          url.pathname === "/api/v1/thread-sections" &&
          ["POST", "PATCH", "DELETE"].includes(method)
        ) {
          const body = await new Request(
            input instanceof Request ? input : url,
            init,
          ).json();
          if (method === "POST") {
            const request = createThreadSectionRequestSchema.parse(body);
            const section: ThreadSectionResponse = {
              id: `section_story_${crypto.randomUUID()}`,
              name: request.name,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            queryClient.setQueryData<SidebarBootstrapResponse>(
              sidebarNavigationQueryKey(),
              {
                ...navigation,
                sections: [...navigation.sections, section],
              },
            );
            return Response.json(section);
          }
          const request =
            method === "PATCH"
              ? updateThreadSectionRequestSchema.parse(body)
              : deleteThreadSectionRequestSchema.parse(body);
          const section = navigation.sections.find(
            (entry) => entry.id === request.id,
          );
          if (!section)
            return Response.json(
              { error: "Section not found" },
              { status: 404 },
            );
          const renamed = "name" in request ? request.name : section.name;
          let updatedThreadCount = 0;
          const updateThread = (thread: ThreadListEntry): ThreadListEntry => {
            if (method !== "DELETE" || thread.sectionId !== section.id)
              return thread;
            updatedThreadCount += 1;
            return { ...thread, sectionId: null };
          };
          queryClient.setQueryData<SidebarBootstrapResponse>(
            sidebarNavigationQueryKey(),
            {
              ...navigation,
              sections:
                method === "DELETE"
                  ? navigation.sections.filter(
                      (entry) => entry.id !== section.id,
                    )
                  : navigation.sections.map((entry) =>
                      entry.id === section.id
                        ? { ...entry, name: renamed, updatedAt: Date.now() }
                        : entry,
                    ),
              projects: navigation.projects.map((project) => ({
                ...project,
                threads: project.threads.map(updateThread),
              })),
              personalProject: {
                ...navigation.personalProject,
                threads: navigation.personalProject.threads.map(updateThread),
              },
            },
          );
          return Response.json({
            id: section.id,
            name: renamed,
            updatedThreadCount,
          });
        }
        const match = url.pathname.match(
          /^\/api\/v1\/threads\/([^/]+)(?:\/(pin|unpin))?$/,
        );
        const thread = match
          ? [
              ...navigation.projects.flatMap((project) => project.threads),
              ...navigation.personalProject.threads,
            ].find((entry) => entry.id === match[1])
          : undefined;
        if (thread && match) {
          if (method === "GET" && !match[2])
            return Response.json(makeThreadResponse(thread));
          if (method === "POST" && match[2]) {
            const pinnedAt = match[2] === "pin" ? Date.now() : null;
            const updatePin = (entry: ThreadListEntry): ThreadListEntry =>
              entry.id === thread.id
                ? { ...entry, pinnedAt, pinSortKey: null }
                : entry;
            queryClient.setQueryData<SidebarBootstrapResponse>(
              sidebarNavigationQueryKey(),
              {
                ...navigation,
                projects: navigation.projects.map((project) => ({
                  ...project,
                  threads: project.threads.map(updatePin),
                })),
                personalProject: {
                  ...navigation.personalProject,
                  threads: navigation.personalProject.threads.map(updatePin),
                },
              },
            );
            return Response.json(makeThreadResponse({ ...thread, pinnedAt }));
          }
        }
      }
      return originalFetch.call(globalThis, input, init);
    };
    globalThis.fetch = fixtureFetch;
    const previousOrder = store.get(pluginNavPanelOrderAtom);
    const previousVisibility = store.get(pluginNavVisiblePanelKeysAtom);
    const collapseAtoms = [
      collapsedThreadIdsAtom,
      collapsedEnvironmentIdsAtom,
      collapsedProjectIdsAtom,
    ];
    const previousCollapse = collapseAtoms.map((atom) => ({
      atom,
      value: store.get(atom),
    }));
    const previousSections = store.get(collapsedSidebarSectionIdsAtom);
    const previousSort = store.get(sidebarChronologicalSortAtom);
    const previousDirection = store.get(sidebarSortDirectionAtom);
    for (const atom of collapseAtoms) store.set(atom, []);
    store.set(collapsedSidebarSectionIdsAtom, []);
    store.set(sidebarChronologicalSortAtom, "updated");
    store.set(sidebarSortDirectionAtom, "default");
    store.set(pluginNavPanelOrderAtom, []);
    store.set(pluginNavVisiblePanelKeysAtom, null);
    setPluginSlotRegistrations(
      STORY_NAVIGATION_PLUGIN_ID,
      makePluginRegistrationSet({
        navPanels: [
          {
            id: "doctrine",
            title: "Design Doctrine",
            icon: "Palette",
            path: "doctrine",
            component: () => null,
          },
        ],
      }),
    );
    markPluginFrontendsSettled();
    setOrganizationMode("project");
    navigate.current(
      `/projects/${CURRENT_ATLAS_PROJECT.id}/threads/thr_thread_list_pinned`,
      { replace: true },
    );
    setReady(true);

    return () => {
      setReady(false);
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = originalFetch;
      removePluginSlotRegistrations(STORY_NAVIGATION_PLUGIN_ID);
      store.set(pluginNavPanelOrderAtom, previousOrder);
      store.set(pluginNavVisiblePanelKeysAtom, previousVisibility);
      for (const { atom, value } of previousCollapse) store.set(atom, value);
      store.set(collapsedSidebarSectionIdsAtom, previousSections);
      store.set(sidebarChronologicalSortAtom, previousSort);
      store.set(sidebarSortDirectionAtom, previousDirection);
      if (!initiallySettled.current) resetPluginFrontendBootStateForTest();
      navigate.current(initialLocation.current, { replace: true });
      setOrganizationMode(initialOrganizationMode.current);
      for (const { queryKey, previous } of [
        ...previousQueries,
        ...previousThreadQueries,
      ]) {
        if (previous === undefined) {
          queryClient.removeQueries({ queryKey, exact: true });
        } else {
          queryClient.setQueryData(queryKey, previous);
        }
      }
    };
  }, [queryClient, setOrganizationMode, store]);

  return ready ? <AppCommandProvider>{children}</AppCommandProvider> : null;
}

const ALL_STORY_THREADS = [
  ...CURRENT_COMPARISON_NAVIGATION.projects.flatMap(
    (project) => project.threads,
  ),
  ...CURRENT_COMPARISON_NAVIGATION.personalProject.threads,
];

function ThreadListControls() {
  const quickCreateProject = useQuickCreateProject();
  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <div className="m-4 flex h-[700px] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground">
          <SidebarChrome />
          <div className="mx-2 mt-3 border-t border-sidebar-border/45" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ProjectList
              onNewProject={quickCreateProject.openCreateDialog}
              isCreatingProject={quickCreateProject.isCreating}
            />
          </div>
        </div>
        <ProjectPathDialog
          target={quickCreateProject.projectPathDialog.target}
          pending={quickCreateProject.isCreating}
          platform={quickCreateProject.platform}
          hostId={quickCreateProject.hostId}
          hostName={quickCreateProject.hostName}
          hosts={quickCreateProject.hosts}
          onOpenChange={quickCreateProject.projectPathDialog.onOpenChange}
          onSubmit={quickCreateProject.submitProjectPath}
        />
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}

export function Overview() {
  return (
    <ThreadListStoryFixture>
      <ThreadListControls />
    </ThreadListStoryFixture>
  );
}
