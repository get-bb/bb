// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  ThreadResponse,
  ThreadTimelineResponse,
  TimelineRow,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { ThreadTimelineSurface } from "@/components/thread/timeline/ThreadTimelineSurface";
import { useThreadTimelineController } from "@/components/thread/timeline/useThreadTimelineController";
import { sdk } from "@/lib/sdk";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { threadListQueryKey } from "@/hooks/queries/query-keys";
import { installFakeFlowLayout } from "@/test/fake-flow-layout";
import {
  makeThreadResponse,
  makeThreadTimelineResponse,
} from "@/test/fixtures/thread-responses";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useThreadDetailThread } from "./useThreadDetailThread";

const SEED_COUNT = Number(process.env.OPENING_MODEL_SEEDS ?? 40);
const THREAD_ID = "thr_opening";
const DESKTOP_SEGMENT_LIMIT = 20;
const COMPACT_SEGMENT_LIMIT = 8;
const THRESHOLD_PX = 4;

const viewport = vi.hoisted(() => ({ compact: false }));

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: { threads: { get: vi.fn(), timeline: vi.fn(), markRead: vi.fn() } },
  };
});

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
  useThreadTimelineRealtimeSubscription: vi.fn(),
}));

vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => "connected",
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@bb/shared-ui/hooks/use-compact-viewport")
    >();
  return { ...actual, useIsCompactViewport: () => viewport.compact };
});

vi.mock("@/lib/user-activity", () => ({ useUserActive: () => true }));

function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
  };
}

interface HistoryRow {
  row: TimelineRow;
  height: number;
  segmentStart: boolean;
  authoredByReader: boolean;
}

interface Pending {
  label: string;
  release: () => void;
}

function OpenedThread() {
  const { unreadDividerState } = useThreadDetailThread(
    THREAD_ID,
    true,
    "first-unread-row",
  );
  const timeline = useThreadTimelineController({ threadId: THREAD_ID });
  return (
    <BottomAnchoredScrollBody
      footer={null}
      maxWidthClassName=""
      scrollAnchorThreadId={THREAD_ID}
    >
      <ThreadTimelineSurface
        activeThinking={null}
        contextBoundarySeq={null}
        hasOlderTimelineRows={timeline.hasOlderTimelineRows}
        isLoadingOlderTimelineRows={timeline.isLoadingOlderTimelineRows}
        isThreadTimelinePending={
          timeline.timelineLoading && timeline.timelineRows.length === 0
        }
        onLoadOlderRows={timeline.loadOlderTimelineRows}
        showOngoingIndicator={false}
        threadId={THREAD_ID}
        threadRuntimeDisplayStatus="idle"
        timelineError={false}
        timelineRows={timeline.timelineRows}
        unreadDividerAutoScroll={unreadDividerState.autoScroll}
        unreadDividerPlacement={unreadDividerState.placement}
        workspaceRootPath={undefined}
      />
    </BottomAnchoredScrollBody>
  );
}

function Host({ shown }: { shown: boolean }) {
  return shown ? <OpenedThread /> : <div data-testid="other-thread" />;
}

let restoreLayout: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "Date",
    ],
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  restoreLayout?.();
  restoreLayout = null;
  vi.mocked(sdk.threads.get).mockReset();
  vi.mocked(sdk.threads.timeline).mockReset();
  vi.mocked(sdk.threads.markRead).mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function runSeed(seed: number): Promise<void> {
  const random = createRandom(seed);
  const compact = random.next() < 0.5;
  viewport.compact = compact;
  const segmentLimit = compact ? COMPACT_SEGMENT_LIMIT : DESKTOP_SEGMENT_LIMIT;
  const viewportHeight = compact ? 760 : random.int(500, 950);

  let seq = 0;
  let clock = 1_000_000;
  const history: HistoryRow[] = [];
  const appendSegment = (kind: "reader" | "agent") => {
    seq += 1;
    clock += random.int(500, 60_000);
    history.push({
      row: conversationRow({
        id: `msg-${seq}`,
        role: "user",
        initiator: kind === "reader" ? "user" : "agent",
        seq,
        createdAt: clock,
        startedAt: clock,
        text: `${kind} message ${seq}`,
        threadId: THREAD_ID,
        turnId: `turn-${seq}`,
      }),
      height: random.int(50, 160),
      segmentStart: true,
      authoredByReader: kind === "reader",
    });
    const replies = random.int(1, 3);
    for (let index = 0; index < replies; index += 1) {
      seq += 1;
      clock += random.int(500, 30_000);
      history.push({
        row: conversationRow({
          id: `msg-${seq}`,
          role: "assistant",
          seq,
          createdAt: clock,
          startedAt: clock,
          text: `reply ${seq}`,
          threadId: THREAD_ID,
          turnId: `turn-${seq}`,
        }),
        height: random.int(40, 520),
        segmentStart: false,
        authoredByReader: false,
      });
    }
  };
  const segmentCount = random.int(3, 34);
  for (let index = 0; index < segmentCount; index += 1) {
    appendSegment(random.next() < 0.6 ? "reader" : "agent");
  }

  const heights = new Map<string, number>();
  const heightOfRow = (id: string) => heights.get(id) ?? 80;
  const syncHeights = () => {
    for (const entry of history) heights.set(entry.row.id, entry.height);
  };
  syncHeights();

  let lastReadAt: number | null = clock + 1;
  let latestAttentionAt = clock;
  let snapshot = 1;

  const pending: Pending[] = [];
  const deferred = <T,>(label: string, value: () => T): Promise<T> =>
    new Promise((resolve) => {
      pending.push({ label, release: () => resolve(value()) });
    });
  const threadResponse = (): ThreadResponse =>
    makeThreadResponse({
      id: THREAD_ID,
      lastReadAt,
      latestAttentionAt,
      status: "idle",
    });
  const pageBefore = (anchorSeq: number | null): ThreadTimelineResponse => {
    const eligible = history.filter(
      (entry) => anchorSeq === null || entry.row.sourceSeqStart < anchorSeq,
    );
    let segments = 0;
    let start = eligible.length;
    while (start > 0 && segments < segmentLimit) {
      start -= 1;
      if (eligible[start]!.segmentStart) segments += 1;
    }
    const pageRows = eligible.slice(start);
    const first = pageRows[0];
    const hasOlder = start > 0 && first !== undefined;
    return makeThreadTimelineResponse({
      rows: pageRows.map((entry) => entry.row),
      maxSeq: seq,
      timelinePage: {
        returnedSegmentCount: segments,
        historySnapshot: `snapshot-${snapshot}`,
        olderCursor: hasOlder
          ? {
              anchorId: `anchor-${first.row.sourceSeqStart}`,
              anchorSeq: first.row.sourceSeqStart,
            }
          : null,
        olderRowsSourceSeqEnd: hasOlder
          ? eligible[start - 1]!.row.sourceSeqEnd
          : null,
      },
    });
  };
  vi.mocked(sdk.threads.get).mockImplementation(((args: { include?: string }) =>
    deferred(args.include === undefined ? "thread" : "bootstrap", () =>
      threadResponse(),
    )) as unknown as typeof sdk.threads.get);
  vi.mocked(sdk.threads.timeline).mockImplementation(((args: {
    beforeAnchorSeq?: string;
  }) =>
    deferred(
      args.beforeAnchorSeq === undefined ? "latest page" : "older page",
      () =>
        pageBefore(
          args.beforeAnchorSeq === undefined
            ? null
            : Number(args.beforeAnchorSeq),
        ),
    )) as unknown as typeof sdk.threads.timeline);

  vi.mocked(sdk.threads.markRead).mockImplementation(() =>
    deferred("mark read", () => {
      lastReadAt = latestAttentionAt;
      return threadResponse();
    }),
  );

  const getScrollElement = () =>
    document.querySelector<HTMLElement>("[data-page-scroll-viewport]");
  const layout = installFakeFlowLayout({
    heightOf: (element) => {
      if (element.hasAttribute("data-scroll-landmark-id")) return 24;
      const rowId = element.getAttribute("data-timeline-row-id");
      if (rowId === null) return null;
      return element.parentElement?.closest("[data-timeline-row-id]")
        ? null
        : heightOfRow(rowId);
    },
    scrollElement: getScrollElement,
    viewportHeight,
  });
  restoreLayout = layout.restore;

  const log: string[] = [
    `seed ${seed} ${compact ? "phone" : "desktop"} viewport=${viewportHeight} segments=${segmentCount}`,
  ];
  const flush = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await act(async () => {
      layout.flushResizeObservers();
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  const releaseAll = async (onRelease?: () => Promise<void>) => {
    for (let guard = 0; guard < 200; guard += 1) {
      await flush(random.int(0, 40));
      if (pending.length === 0) {
        await flush(20);
        if (pending.length === 0) return;
      }
      const index = random.int(0, pending.length - 1);
      const [next] = pending.splice(index, 1);
      log.push(`release ${next!.label}`);
      next!.release();
      await onRelease?.();
    }
    throw new Error(`requests never settled\n  ${log.join("\n  ")}`);
  };
  const rowTop = (id: string): number | null => {
    const scrollElement = getScrollElement();
    const element = [
      ...document.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
    ].find(
      (candidate) => candidate.getAttribute("data-timeline-row-id") === id,
    );
    if (scrollElement === null || element === undefined) return null;
    return (
      element.getBoundingClientRect().top -
      scrollElement.getBoundingClientRect().top
    );
  };
  const topRowOnScreen = (): { id: string; top: number } | null => {
    for (const entry of history) {
      const top = rowTop(entry.row.id);
      if (top !== null && top + entry.height > 1) {
        return { id: entry.row.id, top };
      }
    }
    return null;
  };
  const fail = (message: string): never =>
    expect.fail(
      `${message}\n  scrollTop=${layout.scrollTop} max=${layout.maxScrollTop()}\n  ${log.join("\n  ")}`,
    );

  const { wrapper: Wrapper, queryClient } = createQueryClientTestHarness();
  const tree = (shown: boolean) => (
    <MemoryRouter>
      <Wrapper>
        <Host shown={shown} />
      </Wrapper>
    </MemoryRouter>
  );
  const view = render(tree(false));
  const showThread = (shown: boolean) => view.rerender(tree(shown));

  const returning = random.next() < 0.5;
  let saved: { id: string; top: number } | null = null;
  if (returning) {
    log.push("first visit, read");
    await act(async () => showThread(true));
    await releaseAll();
    await flush(500);
    if (random.next() < 0.5 && layout.maxScrollTop() > 0) {
      const up = random.int(50, 1_500);
      layout.userScrollTo(layout.scrollTop - up);
      log.push(`reader scrolls up ${up}`);
      await flush(3_600);
      if (layout.maxScrollTop() - layout.scrollTop > THRESHOLD_PX) {
        saved = topRowOnScreen();
      }
    }
    await act(async () => showThread(false));
    const away = random.int(10_000, 600_000);
    await flush(away);
    const added = random.int(1, 4);
    for (let index = 0; index < added; index += 1) {
      appendSegment(random.next() < 0.7 ? "agent" : "reader");
    }
    syncHeights();
    snapshot += 1;
    log.push(
      `switched away for ${Math.round(away / 1000)}s; ${added} segments arrived`,
    );
  }

  const readState = random.next();
  const lastReaderRow = [...history]
    .reverse()
    .find((entry) => entry.authoredByReader);
  const realistic = history.filter(
    (entry) =>
      lastReaderRow === undefined ||
      entry.row.startedAt >= lastReaderRow.row.startedAt,
  );
  if (readState < 0.15) {
    lastReadAt = clock + 1;
    log.push("thread read");
  } else if (readState < 0.25) {
    lastReadAt = null;
    log.push("thread marked unread");
  } else {
    const pool = readState < 0.85 ? realistic : history;
    const at = pool[random.int(0, pool.length - 1)]!;
    lastReadAt = at.row.startedAt + random.int(0, 400);
    log.push(
      `read up to ${at.row.id}${pool === history ? " (any point)" : ""}`,
    );
  }
  latestAttentionAt = clock + 2;
  const openingLastReadAt = lastReadAt;

  queryClient.setQueryData(threadListQueryKey({ archived: false }), [
    makeThreadListEntry({ id: THREAD_ID, lastReadAt, latestAttentionAt }),
  ]);
  await act(async () => showThread(true));
  log.push(returning ? "returns to the thread" : "opens the thread");

  let readerScroll: { id: string; top: number } | null = null;
  const scrollWhileLoading = random.next() < 0.2;
  await releaseAll(async () => {
    if (!scrollWhileLoading || readerScroll !== null) return;
    if (random.next() > 0.3 || layout.maxScrollTop() <= 0) return;
    const up = random.int(50, 900);
    layout.userScrollTo(layout.scrollTop - up);
    await flush(16);
    readerScroll = topRowOnScreen();
    log.push(`reader scrolls up ${up} while loading`);
  });
  await flush(4_000);

  const divider = document.querySelector<HTMLElement>(
    "[data-testid=thread-unread-divider]",
  );
  const scrollElement = getScrollElement();
  if (scrollElement === null) return fail("no scroll element");
  const dividerTop =
    divider === null
      ? null
      : divider.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top;
  const fromEnd = layout.maxScrollTop() - layout.scrollTop;
  const attached =
    scrollElement.closest("[data-scroll-attached]") !== null ||
    document.querySelector("[data-scroll-attached]") !== null;
  log.push(
    `settled: divider=${dividerTop === null ? "none" : Math.round(dividerTop)} fromEnd=${Math.round(fromEnd)} attached=${attached}`,
  );

  const unread =
    openingLastReadAt !== null && openingLastReadAt < latestAttentionAt;
  const cutoff = openingLastReadAt ?? 0;
  const expected = unread
    ? history.find(
        (entry) => entry.row.startedAt > cutoff && !entry.authoredByReader,
      )
    : undefined;
  const firstPage = pageBefore(null).rows;
  const firstPageStart = firstPage[0]?.startedAt ?? 0;
  const firstPageHasOlder = firstPage.length < history.length;

  if (attached !== fromEnd <= THRESHOLD_PX) {
    fail(
      attached
        ? "attached but not at the end"
        : "detached at the end (the jump-to-bottom button shows at the bottom)",
    );
  }
  if (divider !== null) {
    if (expected === undefined) fail("a divider shows on a read thread");
    const landmark = divider.closest("[data-scroll-landmark-id]");
    const nextId = landmark?.nextElementSibling?.getAttribute(
      "data-timeline-row-id",
    );
    const previousId = landmark?.previousElementSibling?.getAttribute(
      "data-timeline-row-id",
    );
    const expectedIndex = history.findIndex(
      (entry) => entry.row.id === expected!.row.id,
    );
    if (nextId != null && nextId !== expected!.row.id) {
      fail(`NEW sits above ${nextId}, not above ${expected!.row.id}`);
    }
    if (
      previousId != null &&
      previousId !== history[expectedIndex - 1]?.row.id
    ) {
      fail(`NEW sits below ${previousId}, not above ${expected!.row.id}`);
    }
    if (readerScroll === null && dividerTop !== null) {
      const atTop = Math.abs(dividerTop) <= 1;
      if (!atTop && !(attached && fromEnd <= THRESHOLD_PX)) {
        fail(`NEW landed at ${Math.round(dividerTop)} instead of the top`);
      }
    }
  } else if (
    expected !== undefined &&
    (cutoff >= firstPageStart || !firstPageHasOlder)
  ) {
    fail(`no NEW although the read point is in the first page`);
  }
  if (readerScroll !== null) {
    const scrolled: { id: string; top: number } = readerScroll;
    const top = rowTop(scrolled.id);
    const clamped = layout.scrollTop <= 0.5 || fromEnd <= THRESHOLD_PX;
    if (top !== null && !clamped && Math.abs(top - scrolled.top) > 1) {
      fail(
        `the reader's row ${scrolled.id} moved from ${Math.round(scrolled.top)} to ${Math.round(top)}`,
      );
    }
  } else if (divider === null && returning && saved !== null) {
    const top = rowTop(saved.id);
    const clamped = fromEnd <= THRESHOLD_PX;
    if (top !== null && !clamped && Math.abs(top - saved.top) > 1) {
      fail(
        `returned to ${saved.id} at ${Math.round(top)} instead of its saved ${Math.round(saved.top)}`,
      );
    }
  } else if (divider === null && readerScroll === null && saved === null) {
    if (!attached) fail("opened without NEW but not at the bottom");
  }
}

describe("thread opening model", () => {
  it(
    `lands every opening where the read state says, across ${SEED_COUNT} random loading orders`,
    { timeout: SEED_COUNT * 2_000 },
    async () => {
      for (let seed = 1; seed <= SEED_COUNT; seed += 1) {
        await runSeed(seed);
        cleanup();
        restoreLayout?.();
        restoreLayout = null;
        document.body.replaceChildren();
      }
    },
  );
});
