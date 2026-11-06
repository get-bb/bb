// @vitest-environment jsdom

import { writeFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import { updateCachedThreadListStatusState } from "@/hooks/cache-owners/query-cache";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { ThreadActionCollectors } from "@/lib/thread-actions/thread-action-registry";
import {
  loadPluginThreadListReplacement,
  seedSidebarQueryClient,
  SidebarThreadListHarness,
  stubPluginRpcFetch,
} from "@/test/fixtures/sidebar-thread-list";
import { PluginThreadList } from "./PluginThreadList";

const BENCH_ENABLED = process.env.BB_SIDEBAR_BENCH === "1";
const THREAD_COUNT = Number(process.env.BB_SIDEBAR_BENCH_THREADS ?? 3000);
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

const notificationListRequests: string[][] = [];

const CONFIGURED_NOTIFICATION_LEVELS = new Map(
  Array.from({ length: 100 }, (_, index) => [
    `thr_${index * 13}`,
    { own: index % 2 === 0 ? "muted" : "input-only", ancestorCap: null },
  ]),
);

function stubNotificationRpcFetch(): void {
  stubPluginRpcFetch((method, body) => {
    let result: unknown = null;
    if (method === "listPreferences") {
      result = { preferences: {} };
    } else if (method === "threadNotifications.list") {
      const { threadIds } = z
        .object({ threadIds: z.array(z.string()) })
        .parse(JSON.parse(body));
      notificationListRequests.push(threadIds);
      result = {
        threads: Object.fromEntries(
          threadIds.flatMap((id) => {
            const level = CONFIGURED_NOTIFICATION_LEVELS.get(id);
            return level === undefined ? [] : [[id, level]];
          }),
        ),
      };
    } else if (method === "threadNotifications.keyed") {
      const { keys } = z
        .object({ keys: z.array(z.string()) })
        .parse(JSON.parse(body));
      notificationListRequests.push(keys);
      result = Object.fromEntries(
        keys.map((id) => [
          id,
          CONFIGURED_NOTIFICATION_LEVELS.get(id) ?? {
            own: "inherit",
            ancestorCap: null,
          },
        ]),
      );
    } else if (method === "setPreference" || method === "resetPreference") {
      result = JSON.parse(body);
    }
    return {
      result,
      keyTags: Object.fromEntries(
        notificationListRequests.at(-1)?.map((id) => [id, [`thread:${id}`]]) ??
          [],
      ),
    };
  });
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
    renameThreadAsync: vi.fn(async () => undefined),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

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
      return this.matches('[data-sidebar="content"]')
        ? VIEWPORT_HEIGHT
        : ROW_HEIGHT;
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
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        heightDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
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
  queryObservers: number;
  queryObserversPerRow: number;
}

async function runScenario(
  list: string,
  queryClient: QueryClient,
  body: ReactNode,
): Promise<BenchResults> {
  const restoreViewport = installViewport();
  const mountStart = performance.now();
  const rendered = render(
    <SidebarThreadListHarness queryClient={queryClient}>
      {body}
    </SidebarThreadListHarness>,
  );
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
  const queryObservers = queryClient
    .getQueryCache()
    .getAll()
    .reduce((total, query) => total + query.getObserversCount(), 0);

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
          },
          activity: {
            activeWorkflowCount: 0,
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activePlanModeCount: 0,
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
    queryObservers,
    queryObserversPerRow:
      Math.round((queryObservers / renderedRows) * 100) / 100,
  };
  process.stdout.write(`SIDEBAR_BENCH ${JSON.stringify(results)}\n`);
  return results;
}

describe.skipIf(!BENCH_ENABLED)("sidebar thread list benchmark", () => {
  const collected: BenchResults[] = [];

  it(
    `mounts and updates the plugin list with ${THREAD_COUNT} threads`,
    { timeout: 180_000 },
    async () => {
      stubNotificationRpcFetch();
      const replacement = await loadPluginThreadListReplacement({
        withNotifications: true,
      });
      collected.push(
        await runScenario(
          "plugin",
          seedSidebarQueryClient(THREAD_COUNT),
          <>
            <ThreadActionCollectors
              coreRegistrations={CORE_THREAD_ACTIONS}
              requestRename={() => {}}
            />
            <PluginThreadList replacement={replacement} onNavigate={() => {}} />
          </>,
        ),
      );
      const requestedIds = notificationListRequests.flat();
      expect(notificationListRequests.length).toBeGreaterThan(0);
      expect(new Set(requestedIds).size).toBe(requestedIds.length);
      process.stdout.write(
        `SIDEBAR_BENCH_NOTIFICATIONS ${JSON.stringify({
          listCalls: notificationListRequests.length,
          idsRequested: requestedIds.length,
        })}\n`,
      );
      vi.unstubAllGlobals();
    },
  );

  it("writes the comparison", () => {
    const out = process.env.BB_SIDEBAR_BENCH_OUT;
    if (out) writeFileSync(out, `${JSON.stringify(collected, null, 2)}\n`);
  });
});
