import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import type { AppCommandId, AppKeybinding, ThreadListEntry } from "@bb/domain";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { threadListEntryActionTarget } from "@/lib/thread-actions/thread-action-target";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { ThreadActionsProvider } from "./ThreadActionsProvider";
import { ThreadActionsMenu } from "./ThreadActionsMenu";

export default {
  title: "thread/Thread actions menu",
};

function Stage({ children }: { children: ReactNode }) {
  return (
    <ThreadActionsProvider>
      <div className="flex w-fit items-center rounded-md bg-sidebar p-2 text-sidebar-foreground">
        {children}
      </div>
    </ThreadActionsProvider>
  );
}

function Menu({ thread }: { thread: ThreadListEntry }) {
  return (
    <ThreadActionsMenu
      thread={threadListEntryActionTarget(thread)}
      trigger={(props) => (
        <button {...props} type="button" aria-label="Thread actions">
          ...
        </button>
      )}
    />
  );
}

export function Overview() {
  const readThread = makeThreadListEntry({
    id: "thr_read",
    lastReadAt: 200,
    latestAttentionAt: 100,
  });
  const unreadPinnedThread = makeThreadListEntry({
    id: "thr_unread",
    lastReadAt: 100,
    latestAttentionAt: 200,
    pinnedAt: 150,
  });
  const archivedThread = makeThreadListEntry({
    id: "thr_archived",
    archivedAt: 150,
  });

  return (
    <StoryCard>
      <StoryRow
        label="read · unpinned"
        hint="Mark unread · Pin — Rename — Archive · Delete"
      >
        <Stage>
          <Menu thread={readThread} />
        </Stage>
      </StoryRow>
      <StoryRow
        label="unread · pinned"
        hint="read toggle flips to Mark read; Pin flips to Unpin"
      >
        <Stage>
          <Menu thread={unreadPinnedThread} />
        </Stage>
      </StoryRow>
      <StoryRow label="archived" hint="Archive flips to Unarchive">
        <Stage>
          <Menu thread={archivedThread} />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}

function boundChord(command: AppCommandId, key: string): AppKeybinding {
  return {
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  };
}

function createBoundShortcutsQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      },
    },
  });
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      keybindings: [
        boundChord("thread.pin", "."),
        boundChord("thread.markRead", "u"),
        boundChord("thread.archive", "e"),
      ],
    }),
  );
  return queryClient;
}

export function BoundShortcuts() {
  const [queryClient] = useState(createBoundShortcutsQueryClient);
  const thread = makeThreadListEntry({
    id: "thr_bound",
    lastReadAt: 200,
    latestAttentionAt: 100,
  });

  return (
    <QueryClientProvider client={queryClient}>
      <AppCommandProvider>
        <StoryCard>
          <StoryRow
            label="bound shortcuts"
            hint="Pin, Mark unread and Archive show their chords; unbound Rename shows none"
          >
            <Stage>
              <Menu thread={thread} />
            </Stage>
          </StoryRow>
        </StoryCard>
      </AppCommandProvider>
    </QueryClientProvider>
  );
}
