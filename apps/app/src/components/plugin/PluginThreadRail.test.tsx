// @vitest-environment jsdom

import { Profiler, useEffect, useState, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadRailProps } from "@get-bb/plugin-sdk";
import type { ThreadConversationOutlineItem } from "@bb/server-contract";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import {
  threadQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import {
  TimelineViewportProvider,
  TimelineViewportScrollSource,
} from "@/lib/timeline-viewport";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  makeThreadResponse,
  makeThreadTimelineResponse,
} from "@/test/fixtures/thread-responses";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { createInertScrollPositionKeeper } from "@/test/scroll-position-keeper";

const outline = vi.hoisted(() => ({
  items: [] as ThreadConversationOutlineItem[],
  calls: [] as { role: string; enabled: boolean }[],
}));

vi.mock("@/hooks/queries/thread-panel-queries", async (importActual) => ({
  ...(await importActual<
    typeof import("@/hooks/queries/thread-panel-queries")
  >()),
  useThreadConversationOutline: (
    _threadId: string,
    role: "user" | "assistant",
    options: { enabled: boolean },
  ) => {
    outline.calls.push({ role, enabled: options.enabled });
    return options.enabled
      ? {
          status: "success",
          data: {
            maxSeq: 1_000,
            items: outline.items.filter((item) => item.role === role),
          },
        }
      : { status: "pending", data: undefined };
  },
}));

import coreThreadOutline from "@/core-contributions/thread-outline";
import { collectCoreContributionSlots } from "@/lib/core-contributions";
import { lazyPartOf } from "@/lib/lazy-parts";
import { PluginThreadRail } from "./PluginThreadRail";
import { threadRailOutlineProviderAtom } from "./thread-rail-outline-pick";

const THREAD_ID = "thr_rail";

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe: ResizeObserver["observe"] = (target) => {
    const element = target as HTMLElement;
    const paddingX =
      (Number.parseFloat(element.style.paddingLeft) || 0) +
      (Number.parseFloat(element.style.paddingRight) || 0);
    const inlineSize = Math.max(0, element.clientWidth - paddingX);
    this.callback(
      [
        {
          target,
          contentBoxSize: [{ inlineSize, blockSize: 0 }],
          contentRect: { width: inlineSize } as DOMRectReadOnly,
        } as unknown as ResizeObserverEntry,
      ],
      this,
    );
  };
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}


for (const { component } of collectCoreContributionSlots(
  coreThreadOutline,
  "threadRailOutlines",
)) {
  await lazyPartOf(component)?.load();
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function userItem(index: number, preview = `Prompt ${index}`) {
  return {
    id: `user-${index}`,
    messageSeq: index * 10,
    role: "user" as const,
    preview,
    attachmentSummary: null,
  };
}

function agentItem(index: number) {
  return {
    id: `agent-${index}`,
    messageSeq: index * 10 + 5,
    role: "assistant" as const,
    preview: `Reply ${index}`,
    attachmentSummary: null,
  };
}

let scrollElement: HTMLElement;
let locations: string[];
let navigationTypes: string[];

function placeRows(
  positions: ReadonlyArray<{ id: string; top: number; bottom: number }>,
  { atLatest = false }: { atLatest?: boolean } = {},
) {
  scrollElement.replaceChildren();
  Object.defineProperty(scrollElement, "scrollTop", {
    configurable: true,
    value: atLatest ? 900 : 400,
  });
  for (const position of positions) {
    const row = document.createElement("div");
    row.dataset.timelineRowId = position.id;
    row.getBoundingClientRect = () => rect(position.top, position.bottom);
    scrollElement.appendChild(row);
  }
  act(() => {
    scrollElement.dispatchEvent(new Event("scroll"));
  });
}

function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  const href = `${location.pathname}${location.hash}`;
  if (locations.at(-1) !== `${location.key}:${href}`) {
    locations.push(`${location.key}:${href}`);
    navigationTypes.push(type);
  }
  return null;
}

function renderRail({
  hostWidth = 1_200,
  queryClient = createQueryClientTestHarness().queryClient,
  store = createStore(),
  messageIds = new Set<string>(),
  onRender = () => {},
}: {
  hostWidth?: number;
  queryClient?: QueryClient;
  store?: ReturnType<typeof createStore>;
  messageIds?: ReadonlySet<string>;
  onRender?: () => void;
} = {}) {
  if (
    queryClient.getQueryData(threadTimelineQueryKey(THREAD_ID)) === undefined
  ) {
    queryClient.setQueryData(
      threadTimelineQueryKey(THREAD_ID),
      makeThreadTimelineResponse(),
    );
  }
  const getScrollElement = () => scrollElement;
  const anchor = (isAtBottom: boolean): BottomAnchorContextValue => ({
    positionKeeper: createInertScrollPositionKeeper(),
    holdContentPosition: vi.fn(),
    getScrollElement,
    isAtBottom,
    scrollElementIntoView: vi.fn(),
    scrollToBottom: vi.fn(),
  });
  const anchorControl: { set: (value: BottomAnchorContextValue) => void } = {
    set: () => {},
  };
  function AnchorHost({ children }: { children: ReactNode }) {
    const [value, setValue] = useState(() => anchor(false));
    useEffect(() => {
      anchorControl.set = setValue;
    }, []);
    return (
      <BottomAnchorContext.Provider value={value}>
        <TimelineViewportScrollSource />
        {children}
      </BottomAnchorContext.Provider>
    );
  }
  const ui = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <MemoryRouter initialEntries={[`/threads/${THREAD_ID}`]}>
          <LocationProbe />
          <TimelineViewportProvider
            messageIds={messageIds}
            threadId={THREAD_ID}
          >
            <AnchorHost>
              <div
                ref={(node) => {
                  if (!node) return;
                  Object.defineProperty(node, "clientWidth", {
                    configurable: true,
                    value: hostWidth,
                  });
                }}
                data-scroll-overlay=""
              >
                {children}
              </div>
            </AnchorHost>
          </TimelineViewportProvider>
        </MemoryRouter>
      </JotaiProvider>
    </QueryClientProvider>
  );
  const view = render(
    ui(
      <Profiler id="rail" onRender={onRender}>
        <PluginThreadRail
          threadId={THREAD_ID}
          projectId="proj_rail"
          environmentId={null}
        />
      </Profiler>,
    ),
  );
  return {
    ...view,
    setAnchor: (isAtBottom: boolean) => anchorControl.set(anchor(isAtBottom)),
  };
}

function openOutline() {
  const toc = document.querySelector<HTMLElement>("[data-thread-toc]");
  if (!toc) throw new Error("bb's outline is not rendered");
  fireEvent.mouseEnter(toc);
}

function activeTickIndexes(): number[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-thread-toc] [aria-hidden] > span",
    ),
  ).flatMap((tick, index) => (tick.classList.contains("w-5") ? [index] : []));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  scrollElement = document.createElement("div");
  Object.defineProperty(scrollElement, "clientHeight", { value: 100 });
  Object.defineProperty(scrollElement, "scrollHeight", { value: 1_000 });
  scrollElement.getBoundingClientRect = () => rect(0, 100);
  locations = [];
  navigationTypes = [];
  outline.items = [userItem(1), userItem(2), userItem(3)];
  outline.calls = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  window.localStorage.clear();
});

describe("bb's thread outline in the rail", () => {
  it("reveals a clicked prompt in place, replacing the history entry", () => {
    const queryClient = createQueryClientTestHarness().queryClient;
    queryClient.setQueryData(
      threadQueryKey(THREAD_ID),
      makeThreadResponse({ id: THREAD_ID, projectId: "proj_rail" }),
    );
    renderRail({ queryClient });
    openOutline();
    fireEvent.click(screen.getByRole("button", { name: "Prompt 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Prompt 3" }));
    expect(locations.slice(1).map((entry) => entry.split(":")[1])).toEqual([
      `/projects/proj_rail/threads/${THREAD_ID}#msg=20`,
      `/projects/proj_rail/threads/${THREAD_ID}#msg=30`,
    ]);
    expect(navigationTypes.slice(1)).toEqual(["REPLACE", "REPLACE"]);
  });

  it("does not re-render while a reply streams and the outline is closed", async () => {
    const queryClient = createQueryClientTestHarness().queryClient;
    const stream = async (seq: number, text: string) => {
      await act(async () => {
        queryClient.setQueryData(
          threadTimelineQueryKey(THREAD_ID),
          makeThreadTimelineResponse({
            rows: [
              conversationRow({
                id: "user-3",
                role: "user",
                seq: 30,
                text: "Prompt 3",
              }),
              conversationRow({ id: "reply", role: "assistant", seq, text }),
            ],
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    let renders = 0;
    const { setAnchor } = renderRail({
      queryClient,
      onRender: () => (renders += 1),
    });
    await stream(31, "Partial");
    const settled = renders;
    for (let seq = 32; seq < 40; seq += 1) {
      await stream(seq, `Partial reply ${"word ".repeat(seq)}`);
      act(() => setAnchor(seq % 2 === 0));
    }
    expect(renders).toBe(settled);
  });

  it("stays out of the way until the thread has three prompts", () => {
    outline.items = [userItem(1), userItem(2)];
    renderRail();
    expect(document.querySelector("[data-thread-toc]")).toBeNull();
  });

  it("keeps the rail mounted but hidden, inert and not reading while the pane is too narrow", () => {
    const seen: boolean[] = [];
    setPluginSlotRegistrations(
      "minimap",
      makePluginRegistrationSet({
        threadRails: [
          {
            id: "strip",
            component: ({ visible }: ExperimentalThreadRailProps) => {
              seen.push(visible);
              return null;
            },
          },
        ],
      }),
    );
    renderRail({ hostWidth: 800 });
    const rail = document.querySelector<HTMLElement>("[data-thread-rail]");
    expect(rail?.className).toContain("hidden");
    expect(rail?.hasAttribute("inert")).toBe(true);
    expect(seen.at(-1)).toBe(false);
    expect(outline.calls.some((call) => call.enabled)).toBe(false);
  });

  it("reads agent replies only once the Agent tab is chosen", async () => {
    const queryClient = createQueryClientTestHarness().queryClient;
    queryClient.setQueryData(
      threadTimelineQueryKey(THREAD_ID),
      makeThreadTimelineResponse({
        rows: [
          conversationRow({
            id: "agent-live",
            role: "assistant",
            seq: 99,
            text: "Live reply",
          }),
        ],
      }),
    );
    outline.items = [userItem(1), userItem(2), userItem(3), agentItem(1)];
    renderRail({ queryClient });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    openOutline();
    const assistantReads = () =>
      outline.calls.filter((call) => call.role === "assistant" && call.enabled);
    expect(assistantReads()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Agent messages" }));
    expect(assistantReads().length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Reply 1" })).toBeTruthy();
  });

  it("names a prompt's sender thread even when the sidebar does not hold it", async () => {
    vi.spyOn(sdk.threads, "get").mockResolvedValue(
      makeThreadResponse({
        id: "thr_archived_sender",
        projectId: "proj_rail",
        title: "Archived worker",
        archivedAt: 5,
      }),
    );
    outline.items = [
      userItem(1),
      userItem(2),
      userItem(
        3,
        "[bb message from thread:thr_archived_sender] Done with the review",
      ),
    ];
    renderRail();
    openOutline();
    await waitFor(() =>
      expect(screen.getByTitle("Thread: Archived worker")).toBeTruthy(),
    );
    expect(screen.getByText("Done with the review")).toBeTruthy();
  });

  it("marks the first prompt in view, or the last one at the latest message", async () => {
    const ids = new Set(["user-1", "agent-1", "user-2", "user-3"]);
    renderRail({ messageIds: ids });
    placeRows([
      { id: "user-1", top: -40, bottom: -20 },
      { id: "agent-1", top: -10, bottom: 10 },
      { id: "user-2", top: 20, bottom: 40 },
      { id: "user-3", top: 60, bottom: 80 },
    ]);
    await waitFor(() => expect(activeTickIndexes()).toEqual([1]));
    placeRows(
      [
        { id: "user-2", top: 20, bottom: 40 },
        { id: "user-3", top: 60, bottom: 80 },
      ],
      { atLatest: true },
    );
    await waitFor(() => expect(activeTickIndexes()).toEqual([2]));
  });

  it("caps the rail at twenty ticks and keeps the active prompt among them", async () => {
    outline.items = Array.from({ length: 60 }, (_, index) =>
      userItem(index + 1),
    );
    renderRail({ messageIds: new Set(["user-31"]) });
    placeRows([{ id: "user-31", top: 10, bottom: 30 }]);
    await waitFor(() =>
      expect(
        document.querySelectorAll("[data-thread-toc] [aria-hidden] > span"),
      ).toHaveLength(20),
    );
    await waitFor(() => expect(activeTickIndexes()).toHaveLength(1));
  });
});

describe("thread outline pick", () => {
  function registerOutline(component: () => ReactNode) {
    setPluginSlotRegistrations(
      "threadline",
      makePluginRegistrationSet({
        threadRailOutlines: [{ id: "threadline", component }],
        threadRails: [
          { id: "strip", component: () => <div data-testid="strip" /> },
        ],
      }),
    );
    markPluginFrontendsSettled();
  }

  it("replaces bb's outline with an installed plugin's under Automatic, with rail items below it", () => {
    registerOutline(() => <div data-testid="threadline" />);
    renderRail();
    expect(document.querySelector("[data-thread-toc]")).toBeNull();
    const rail = document.querySelector("[data-thread-rail]");
    expect(
      Array.from(rail?.querySelectorAll("[data-testid]") ?? []).map((element) =>
        element.getAttribute("data-testid"),
      ),
    ).toEqual(["threadline", "strip"]);
  });

  it("keeps bb's outline when the user picks it", () => {
    registerOutline(() => <div data-testid="threadline" />);
    const store = createStore();
    store.set(threadRailOutlineProviderAtom, "__builtin__");
    renderRail({ store });
    expect(document.querySelector("[data-thread-toc]")).not.toBeNull();
    expect(screen.queryByTestId("threadline")).toBeNull();
  });

  it("falls back to bb's outline when the picked one crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerOutline(() => {
      throw new Error("threadline broke");
    });
    renderRail();
    expect(document.querySelector("[data-thread-toc]")).not.toBeNull();
    expect(screen.getByTestId("strip")).toBeTruthy();
  });
});
