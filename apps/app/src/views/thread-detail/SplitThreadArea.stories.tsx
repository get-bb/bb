import { useMemo } from "react";
import type {
  ThreadResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { makeThread } from "../../../.ladle/story-fixtures";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import {
  threadDetailBootstrapQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import { maximizedPaneIdAtom, splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { SplitLayout } from "@/lib/split-layout";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SplitThreadArea } from "./SplitThreadArea";

export default {
  title: "thread/splits/Split Workspace",
};

const PROJECT_ID = "proj_bb";
const IDLE_THREAD_ID = "thr_split_idle";
const ACTIVE_THREAD_ID = "thr_split_active";

function storyThread(id: string, title: string): ThreadResponse {
  return {
    ...makeThread({
      id,
      projectId: PROJECT_ID,
      environmentId: null,
      title,
      titleFallback: title,
    }),
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    canSpawnChild: false,
  };
}

const idleThread = storyThread(IDLE_THREAD_ID, "Fix Thread Drag Sync");
const activeThread = storyThread(ACTIVE_THREAD_ID, "Refine split styling");

function storyTimeline(
  threadId: string,
  userMessage: string,
  assistantMessages: readonly string[],
): ThreadTimelineResponse {
  return {
    rows: [
      conversationRow({
        id: `${threadId}:user:1`,
        role: "user",
        sourceSeqStart: 1,
        text: userMessage,
        threadId,
        turnId: `${threadId}:turn:1`,
      }),
      ...assistantMessages.map((text, index) =>
        conversationRow({
          id: `${threadId}:assistant:${index + 1}`,
          role: "assistant",
          sourceSeqStart: index + 2,
          text,
          threadId,
          turnId: `${threadId}:turn:1`,
        }),
      ),
    ],
    activePromptMode: null,
    activeThinking: null,
    activeWorkflow: null,
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    maxSeq: assistantMessages.length + 1,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 1,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

const idleTimeline = storyTimeline(
  IDLE_THREAD_ID,
  "When I drag threads between sections, the source row sometimes stays faded after the drop.",
  [
    "I found a race between the drag library's finish callback and React cleanup. The late callback restores the stale inline opacity.",
    "The regression now covers the real drop timing, and the row returns to full opacity without a refresh.",
    "I also checked the sidebar projection and the canonical thread state independently, so the visual cleanup no longer depends on a refresh or another render.",
    "The minimal change keeps the existing drag behavior intact and only prevents the stale finish callback from repainting the source row.",
    "The focused regression now exercises the delayed callback ordering that reproduced the issue in production.",
    "Type checking and the thread drag tests both pass with the fix applied.",
    "A flat, non-interactive light-grey overlay marks this timeline as inactive without blocking it.",
  ],
);

const activeTimeline = storyTimeline(
  ACTIVE_THREAD_ID,
  "Make the divider thinner, keep the inactive timeline readable, and let the header carry focus.",
  [
    "The split seam is now one pixel with a wider invisible resize target. Pane content keeps full contrast while the focused header uses the raised surface treatment.",
    "The same hairline treatment is applied where the secondary panel meets the split workspace, so the seams read as one system.",
    "Inactive timelines receive a light-grey overlay while messages and status rows remain readable and interactive.",
    "The inactive overlay and the raised focused header trade places together as focus moves between panes.",
    "The timeline scrollbar now stays invisible at rest and returns briefly while the pane is actively scrolling.",
    "Its native scroll container and hit area remain intact, so wheel, trackpad, touch, and keyboard scrolling behave exactly as before.",
    "This story intentionally overflows both panes so the transient scrollbar behavior can be checked alongside the divider and focus states.",
  ],
);

const splitLayout: SplitLayout = {
  root: {
    type: "split",
    dir: "row",
    sizes: [0.5, 0.5],
    children: [
      {
        type: "pane",
        paneId: "pane-idle",
        content: {
          kind: "thread",
          projectId: PROJECT_ID,
          threadId: IDLE_THREAD_ID,
        },
      },
      {
        type: "pane",
        paneId: "pane-active",
        content: {
          kind: "thread",
          projectId: PROJECT_ID,
          threadId: ACTIVE_THREAD_ID,
        },
      },
    ],
  },
  focusedPaneId: "pane-active",
};

function createStoryQueryClient(): QueryClient {
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

  for (const [thread, timeline] of [
    [idleThread, idleTimeline],
    [activeThread, activeTimeline],
  ] as const) {
    queryClient.setQueryData(threadDetailBootstrapQueryKey(thread.id), thread);
    queryClient.setQueryData(threadQueryKey(thread.id), thread);
    queryClient.setQueryData(threadTimelineQueryKey(thread.id), timeline);
  }

  return queryClient;
}

function SplitWorkspaceStory() {
  const queryClient = useMemo(createStoryQueryClient, []);
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(splitLayoutAtom, splitLayout);
    nextStore.set(maximizedPaneIdAtom, null);
    return nextStore;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <SidebarProvider>
          <div className="flex h-screen min-h-[640px] w-full flex-col bg-background p-4 md:p-5">
            <SplitThreadArea
              routeContent={{
                kind: "thread",
                projectId: PROJECT_ID,
                threadId: ACTIVE_THREAD_ID,
              }}
            />
          </div>
        </SidebarProvider>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

export function ActiveAndIdle() {
  return <SplitWorkspaceStory />;
}
