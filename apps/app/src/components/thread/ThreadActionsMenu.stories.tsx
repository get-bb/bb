import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import type { ThreadListEntry } from "@bb/domain";
import { holdSidebarThreads } from "@/test/fixtures/related-threads";
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
      thread={thread}
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
  const queryClient = useQueryClient();
  useState(() =>
    holdSidebarThreads(queryClient, [
      readThread,
      unreadPinnedThread,
      archivedThread,
    ]),
  );

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
