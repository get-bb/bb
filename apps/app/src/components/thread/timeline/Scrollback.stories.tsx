import { useEffect, useState } from "react";
import { defaultExperiments } from "@bb/domain";
import {
  computeTimelineRowDelta,
  type ThreadTimelineResponse,
  type TimelinePaginationCursor,
  type TimelineRow,
} from "@bb/server-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { makeThread } from "../../../../.ladle/story-fixtures";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import {
  makeThreadResponse,
  makeThreadTimelineResponse,
} from "@/test/fixtures/thread-responses";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  systemConfigQueryKey,
  threadDetailBootstrapQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import {
  applyThreadTimelineSignal,
  resolveThreadTimelineSegmentLimit,
} from "@/hooks/cache-owners/thread-timeline-push-owner";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { ThreadTimelinePanelContent } from "./ThreadTimelinePanelContent";

export default {
  title: "thread/timeline/Scrollback",
};

const PROJECT_ID = "proj_scrollback";
const THREAD_ID = "thr_scrollback";
const TURNS_PER_PAGE = 2;
const TIMELINE_PATH = `/api/v1/threads/${THREAD_ID}/timeline`;

const ANSWER_PARAGRAPHS = [
  "I traced the request from the route through the cache and into the projection, and the window boundary is where the rows diverge.",
  "The older page and the latest window both include the turn summary, so the client joins their children instead of listing the turn twice.",
  "Nothing in this turn depends on the previous one, which keeps each page independent when it is fetched again after a refresh.",
];

function turnRows(turn: number, startSeq: number): TimelineRow[] {
  const turnId = `turn-${turn}`;
  return [
    conversationRow({
      id: `${THREAD_ID}:user:${turn}`,
      role: "user",
      sourceSeqStart: startSeq,
      text: `Question ${turn}: why does the timeline window move?`,
      threadId: THREAD_ID,
      turnId,
    }),
    conversationRow({
      id: `${THREAD_ID}:assistant:${turn}`,
      role: "assistant",
      sourceSeqStart: startSeq + 1,
      text: `Answer ${turn}.\n\n${ANSWER_PARAGRAPHS.join("\n\n")}`,
      threadId: THREAD_ID,
      turnId,
    }),
  ];
}

class StoryTimelineServer {
  private surfaceVersion = 1;
  private turns: TimelineRow[][] = [];
  maxSeq = 0;
  latestRequests = 0;
  olderRequests = 0;
  reachedStart = false;
  staleCursorResponses = 0;

  constructor(turnCount: number) {
    for (let turn = 1; turn <= turnCount; turn += 1) {
      this.addTurn();
    }
  }

  allRowIds(): string[] {
    return this.turns.flat().map((row) => row.id);
  }

  addTurn(): void {
    const rows = turnRows(this.turns.length + 1, this.maxSeq + 1);
    this.turns.push(rows);
    this.maxSeq += rows.length;
  }

  streamIntoLastAnswer(): void {
    const turn = this.turns.at(-1)!;
    const answer = turn.at(-1)!;
    if (answer.kind !== "conversation") return;
    this.maxSeq += 1;
    turn[turn.length - 1] = {
      ...answer,
      sourceSeqEnd: this.maxSeq,
      text: `${answer.text}\n\nStreamed line ${this.maxSeq}.`,
    };
  }

  renameWithEvent(): void {
    this.surfaceVersion += 1;
    this.maxSeq += 1;
  }

  private cursor(turnIndex: number): TimelinePaginationCursor | null {
    return turnIndex <= 0
      ? null
      : {
          anchorSeq: this.turns[turnIndex]![0]!.sourceSeqStart,
          anchorId: `story-cursor:${this.surfaceVersion}:${turnIndex}`,
        };
  }

  private page(startTurn: number, endTurn: number): ThreadTimelineResponse {
    const rows = this.turns.slice(startTurn, endTurn).flat();
    return makeThreadTimelineResponse({
      rows,
      maxSeq: this.maxSeq,
      timelinePage: {
        returnedSegmentCount: endTurn - startTurn,
        olderCursor: this.cursor(startTurn),
        historySnapshot: `story:${this.surfaceVersion}:${this.maxSeq}`,
        olderRowsSourceSeqEnd: null,
      },
    });
  }

  latest(): ThreadTimelineResponse {
    return this.page(
      Math.max(0, this.turns.length - TURNS_PER_PAGE),
      this.turns.length,
    );
  }

  older(anchorId: string): ThreadTimelineResponse | null {
    this.olderRequests += 1;
    const [, version, turnIndex] = anchorId.split(":");
    if (Number(version) !== this.surfaceVersion) {
      this.staleCursorResponses += 1;
      return null;
    }
    const start = Math.max(0, Number(turnIndex) - TURNS_PER_PAGE);
    this.reachedStart = start === 0;
    return this.page(start, Number(turnIndex));
  }
}

interface ScrollbackStoryControls {
  allRowIds(): string[];
  olderRequests(): number;
  deliverLatest(): void;
  latestRequests(): number;
  reachedStart(): boolean;
  refetchUnchanged(): void;
  renameWithEvent(): void;
  staleCursorResponses(): number;
  stream(): void;
  newTurn(): void;
}

declare global {
  interface Window {
    __timelineScrollback?: ScrollbackStoryControls;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  const href =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(href, window.location.origin);
}

type TimelineDelivery = "refetch" | "push";

function createScrollbackStory(delivery: TimelineDelivery): {
  controls: ScrollbackStoryControls;
  queryClient: QueryClient;
  server: StoryTimelineServer;
} {
  const server = new StoryTimelineServer(30);
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      },
    },
  });
  const thread = makeThreadResponse({
    ...makeThread({
      id: THREAD_ID,
      projectId: PROJECT_ID,
      environmentId: null,
      title: "Scrollback",
      titleFallback: "Scrollback",
    }),
    canSpawnChild: false,
  });
  const timelineKey = threadTimelineQueryKey(THREAD_ID);
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      experiments: {
        ...defaultExperiments,
        timelinePush: delivery === "push",
      },
    }),
  );
  queryClient.setQueryData(threadDetailBootstrapQueryKey(THREAD_ID), thread);
  queryClient.setQueryData(threadQueryKey(THREAD_ID), thread);
  queryClient.setQueryData(timelineKey, server.latest());
  const refetchLatest = () => {
    void queryClient.refetchQueries({ queryKey: timelineKey });
  };
  const pushLatest = () => {
    const previous =
      queryClient.getQueryData<ThreadTimelineResponse>(timelineKey)!;
    const latest = server.latest();
    applyThreadTimelineSignal(queryClient, {
      type: "thread-timeline",
      target: {
        kind: "thread-timeline",
        threadId: THREAD_ID,
        segmentLimit: resolveThreadTimelineSegmentLimit() ?? null,
        deferContent: true,
      },
      afterSequence: previous.maxSeq,
      timeline: {
        ...latest,
        rows: [],
        delta: computeTimelineRowDelta(previous.rows, latest.rows),
      },
    });
  };
  const deliverLatest = delivery === "push" ? pushLatest : refetchLatest;
  const controls: ScrollbackStoryControls = {
    allRowIds: () => server.allRowIds(),
    olderRequests: () => server.olderRequests,
    deliverLatest,
    latestRequests: () => server.latestRequests,
    reachedStart: () => server.reachedStart,
    refetchUnchanged: refetchLatest,
    renameWithEvent: () => server.renameWithEvent(),
    staleCursorResponses: () => server.staleCursorResponses,
    stream: () => {
      server.streamIntoLastAnswer();
      deliverLatest();
    },
    newTurn: () => {
      server.addTurn();
      deliverLatest();
    },
  };
  return { controls, queryClient, server };
}

function ScrollbackStory({
  delivery,
  width,
}: {
  delivery: TimelineDelivery;
  width: number | null;
}) {
  const [story] = useState(() => createScrollbackStory(delivery));
  const [store] = useState(createStore);
  useEffect(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (url.pathname !== TIMELINE_PATH) {
        return originalFetch(input, init);
      }
      const anchorId = url.searchParams.get("beforeAnchorId");
      if (anchorId === null) {
        story.server.latestRequests += 1;
        return jsonResponse(200, story.server.latest());
      }
      const page = story.server.older(anchorId);
      return page === null
        ? jsonResponse(400, {
            code: "invalid_request",
            message:
              "Timeline pagination cursor is no longer available; reload the latest page",
          })
        : jsonResponse(200, page);
    };
    window.__timelineScrollback = story.controls;
    return () => {
      globalThis.fetch = originalFetch;
      delete window.__timelineScrollback;
    };
  }, [story]);

  return (
    <QueryClientProvider client={story.queryClient}>
      <JotaiProvider store={store}>
        <ThreadActionsProvider>
          <SidebarProvider>
            <div
              className="flex h-screen w-full flex-col bg-background"
              style={width === null ? undefined : { maxWidth: width }}
            >
              <div className="flex flex-wrap gap-2 border-b border-border-seam p-2 text-xs">
                <button type="button" onClick={story.controls.stream}>
                  Stream
                </button>
                <button type="button" onClick={story.controls.newTurn}>
                  New turn
                </button>
                <button type="button" onClick={story.controls.refetchUnchanged}>
                  Refetch unchanged
                </button>
                <button type="button" onClick={story.controls.renameWithEvent}>
                  Rename
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <BottomAnchoredScrollBody
                  footer={null}
                  maxWidthClassName="max-w-3xl"
                  contentClassName="!px-2 !pb-3 !pt-4"
                  scrollAnchorThreadId={THREAD_ID}
                >
                  <ThreadTimelinePanelContent
                    projectId={PROJECT_ID}
                    threadId={THREAD_ID}
                  />
                </BottomAnchoredScrollBody>
              </div>
            </div>
          </SidebarProvider>
        </ThreadActionsProvider>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

export function PagedThread() {
  return <ScrollbackStory delivery="refetch" width={null} />;
}

export function PagedThreadPhoneWidth() {
  return <ScrollbackStory delivery="refetch" width={390} />;
}

export function PagedThreadPushed() {
  return <ScrollbackStory delivery="push" width={null} />;
}

export function PagedThreadPushedPhoneWidth() {
  return <ScrollbackStory delivery="push" width={390} />;
}
