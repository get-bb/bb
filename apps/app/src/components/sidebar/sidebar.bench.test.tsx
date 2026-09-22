// @vitest-environment jsdom

import { writeFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultUiPreferences,
  PERSONAL_PROJECT_ID,
  UI_PREFERENCE_KEYS,
  type ThreadListEntry,
  type ThreadStatus,
} from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { makeHost, makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { makeProjectWithThreadsResponse } from "@/test/fixtures/projects";
import {
  hostsQueryKey,
  sidebarNavigationQueryKey,
  uiPreferencesQueryKey,
} from "@/hooks/queries/query-keys";
import { updateCachedThreadListStatusState } from "@/hooks/cache-owners/query-cache";
import { Sidebar, SidebarContent, SidebarProvider } from "@/components/ui/sidebar";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { PluginThreadList } from "./PluginThreadList";
import { ProjectList } from "./ProjectList";

const BENCH_ENABLED = process.env.BB_SIDEBAR_BENCH === "1";
const THREAD_COUNT = Number(process.env.BB_SIDEBAR_BENCH_THREADS ?? 3000);
const PROJECT_COUNT = 40;
const SECTION_COUNT = 8;
const ITERATIONS = 5;

function rejectingSdk(path = "sdk"): unknown {
  return new Proxy(function sdkStub() {}, {
    apply: () => Promise.reject(new Error(`bench: ${path} is offline`)),
    get: (_target, key) =>
      typeof key === "string" && key !== "then"
        ? rejectingSdk(`${path}.${key}`)
        : undefined,
  });
}

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return { ...actual, sdk: rejectingSdk() };
});

vi.mock("@/lib/ws", () => ({
  wsManager: new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "onPluginSignal" ? () => () => {} : () => undefined,
    },
  ),
}));

function stubPluginRpcFetch(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/rpc/")) {
      return new Response("{}", { status: 404 });
    }
    const method = url.split("/rpc/")[1] ?? "";
    let result: unknown = null;
    if (method === "listPreferences") {
      result = { preferences: {} };
    } else if (method === "setPreference" || method === "resetPreference") {
      result = JSON.parse(String(init?.body ?? "{}"));
    }
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

async function loadPluginThreadListReplacement(): Promise<
  ResolvedReplacement<PluginThreadListSlot>
> {
  installPluginRuntime();
  const module = await import("../../../../../plugins/thread-list/app");
  const collected = collectPluginAppRegistrations(module.default);
  const registration = collected.threadLists[0];
  if (registration === undefined) {
    throw new Error("thread-list plugin registered no thread list");
  }
  return {
    kind: "plugin",
    registration: { ...registration, pluginId: "thread-list", generation: 1 },
  };
}

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => ({ hostId: null, hostName: null }),
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: vi.fn(),
    renameThreadAsync: vi.fn(async () => undefined),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

const STATUSES: ThreadStatus[] = ["idle", "active", "idle", "idle", "error"];

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
      projectIndex === PROJECT_COUNT ? personalProject : projects[projectIndex]!;
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
        parent === null && index % 2 === 0 ? `sec_${index % SECTION_COUNT}` : null,
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
    const target = thread.projectId === PERSONAL_PROJECT_ID
      ? personalProject
      : projects.find((candidate) => candidate.id === thread.projectId)!;
    target.threads.push(thread);
  }
  return { sections, projects, personalProject };
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function measure(run: () => void): Promise<number> {
  const start = performance.now();
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return performance.now() - start;
}

const VIEWPORT_HEIGHT = 800;
const ROW_HEIGHT = 30;

function installViewport(): () => void {
  const originalObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
  const heightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.matches('[data-sidebar="content"]') ? VIEWPORT_HEIGHT : ROW_HEIGHT;
    },
  });
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  let wrapperOrder: Map<Element, number> = new Map();
  const wrapperIndex = (element: Element): number => {
    const cached = wrapperOrder.get(element);
    if (cached !== undefined) return cached;
    wrapperOrder = new Map();
    let index = 0;
    for (const wrapper of document.querySelectorAll(
      "[data-sidebar-windowed-item]",
    )) {
      wrapperOrder.set(wrapper, index);
      index += 1;
    }
    return wrapperOrder.get(element) ?? 0;
  };
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.matches('[data-sidebar="content"]')) {
      return new DOMRect(0, 0, 300, VIEWPORT_HEIGHT);
    }
    if (this.hasAttribute("data-sidebar-windowed-item")) {
      return new DOMRect(0, wrapperIndex(this) * ROW_HEIGHT, 300, ROW_HEIGHT);
    }
    return new DOMRect();
  };
  return () => {
    globalThis.IntersectionObserver = originalObserver;
    if (heightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", heightDescriptor);
    }
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  };
}

afterEach(cleanup);

interface BenchResults {
  list: string;
  threads: number;
  renderedRows: number;
  windowedItems: number;
  mountMs: number;
  statusPatchMs: number;
  membershipRefetchMs: number;
  pinMs: number;
}

function seedQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClient.setQueryData(sidebarNavigationQueryKey(), buildBootstrap(THREAD_COUNT));
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

async function runScenario(
  list: string,
  queryClient: QueryClient,
  body: ReactNode,
): Promise<BenchResults> {
  const restoreViewport = installViewport();
  const tree = (
    <TooltipProvider>
      <JotaiProvider store={createStore()}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <SidebarProvider>
              <Sidebar>
                <SidebarContent>{body}</SidebarContent>
              </Sidebar>
            </SidebarProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </JotaiProvider>
    </TooltipProvider>
  );

  const mountStart = performance.now();
  const rendered = render(tree);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const mountMs = performance.now() - mountStart;
  const renderedRows = rendered.container.querySelectorAll(
    "[data-sidebar-thread-id]",
  ).length;
  const windowedItems = rendered.container.querySelectorAll(
    "[data-sidebar-windowed-item]",
  ).length;
  expect(renderedRows).toBeGreaterThan(0);

  const patchSamples: number[] = [];
  const refetchSamples: number[] = [];
  const pinSamples: number[] = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const targetId = `thr_${(iteration * 7) % THREAD_COUNT}`;
    patchSamples.push(
      await measure(() => {
        updateCachedThreadListStatusState(queryClient, targetId, {
          status: iteration % 2 === 0 ? "active" : "idle",
          runtime: {
            displayStatus: iteration % 2 === 0 ? "active" : "idle",
            hostReconnectGraceExpiresAt: null,
          },
          activity: {
            activeWorkflowCount: 0,
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activePlanModeCount: 0,
            activeGoalCount: 0,
          },
          latestAttentionAt: 5_000_000 + iteration,
          updatedAt: 5_000_000 + iteration,
        });
      }),
    );

    refetchSamples.push(
      await measure(() => {
        const current = queryClient.getQueryData<SidebarBootstrapResponse>(
          sidebarNavigationQueryKey(),
        )!;
        let touched = 0;
        const bump = (thread: ThreadListEntry): ThreadListEntry => {
          if (touched >= 50) return thread;
          touched += 1;
          return {
            ...thread,
            updatedAt: 6_000_000 + iteration * 100 + touched,
            latestAttentionAt: 6_000_000 + iteration * 100 + touched,
          };
        };
        queryClient.setQueryData(sidebarNavigationQueryKey(), {
          ...current,
          projects: current.projects.map((project) => ({
            ...project,
            threads: project.threads.map(bump),
          })),
          personalProject: {
            ...current.personalProject,
            threads: current.personalProject.threads.map(bump),
          },
        });
      }),
    );

    pinSamples.push(
      await measure(() => {
        const current = queryClient.getQueryData<SidebarBootstrapResponse>(
          sidebarNavigationQueryKey(),
        )!;
        const pinId = `thr_${(iteration * 11 + 1) % THREAD_COUNT}`;
        const flip = (thread: ThreadListEntry): ThreadListEntry =>
          thread.id === pinId && thread.parentThreadId === null
            ? {
                ...thread,
                pinnedAt: thread.pinnedAt === null ? 9_000_000 : null,
              }
            : thread;
        queryClient.setQueryData(sidebarNavigationQueryKey(), {
          ...current,
          projects: current.projects.map((project) => ({
            ...project,
            threads: project.threads.map(flip),
          })),
          personalProject: {
            ...current.personalProject,
            threads: current.personalProject.threads.map(flip),
          },
        });
      }),
    );
  }

  rendered.unmount();
  restoreViewport();
  const results: BenchResults = {
    list,
    threads: THREAD_COUNT,
    renderedRows,
    windowedItems,
    mountMs: Math.round(mountMs),
    statusPatchMs: Math.round(median(patchSamples)),
    membershipRefetchMs: Math.round(median(refetchSamples)),
    pinMs: Math.round(median(pinSamples)),
  };
  process.stdout.write(`SIDEBAR_BENCH ${JSON.stringify(results)}\n`);
  return results;
}

describe.skipIf(!BENCH_ENABLED)("sidebar thread list benchmark", () => {
  const collected: BenchResults[] = [];

  it(`mounts and updates the built-in list with ${THREAD_COUNT} threads`, { timeout: 180_000 }, async () => {
    collected.push(await runScenario("built-in", seedQueryClient(), <ProjectList />));
  });

  it(`mounts and updates the plugin list with ${THREAD_COUNT} threads`, { timeout: 180_000 }, async () => {
    stubPluginRpcFetch();
    const replacement = await loadPluginThreadListReplacement();
    collected.push(
      await runScenario(
        "plugin",
        seedQueryClient(),
        <PluginThreadList
          replacement={replacement}
          original={null}
          searchQuery=""
          onNavigate={() => {}}
        />,
      ),
    );
    vi.unstubAllGlobals();
  });

  it("writes the comparison", () => {
    const out = process.env.BB_SIDEBAR_BENCH_OUT;
    if (out) writeFileSync(out, `${JSON.stringify(collected, null, 2)}\n`);
  });
});
