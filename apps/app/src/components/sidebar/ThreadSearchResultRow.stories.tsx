import type { ReactNode } from "react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { ThreadSearchMatch } from "@bb/server-contract";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { ThreadSearchResultRow } from "./ThreadSearchResultRow";

export default {
  title: "sidebar/Thread search result",
};

const noop = () => {};
const HOUR_MS = 60 * 60 * 1000;

// Highlight the first occurrence of `term` (case-insensitive), mirroring how the
// server returns highlight ranges for a match.
function highlight(
  text: string,
  term: string,
): ThreadSearchMatch["highlightRanges"] {
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  return index < 0 ? [] : [{ start: index, end: index + term.length }];
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="w-[320px] rounded-md bg-sidebar p-1 text-sidebar-foreground">
      {children}
    </div>
  );
}

const recentThread = makeThreadListEntry({
  id: "thr_recent",
  title: "Refactor the sidebar search panel",
  titleFallback: "Refactor the sidebar search panel",
  updatedAt: Date.now() - 2 * HOUR_MS,
});
const titleMatchThread = makeThreadListEntry({
  id: "thr_title",
  title: "Audit recurring permission failures",
  titleFallback: "Audit recurring permission failures",
  updatedAt: Date.now() - 26 * HOUR_MS,
});
const messageMatchThread = makeThreadListEntry({
  id: "thr_message",
  title: "Worktree cleanup",
  titleFallback: "Worktree cleanup",
  updatedAt: Date.now() - 3 * HOUR_MS,
});
const personalThread = makeThreadListEntry({
  id: "thr_personal",
  projectId: PERSONAL_PROJECT_ID,
  title: "Plan the offsite",
  titleFallback: "Plan the offsite",
  updatedAt: Date.now() - 5 * HOUR_MS,
});

const messageSnippet =
  "The permission prompts keep recurring after the worktree is recreated — here is the fix I landed and why it works.";

// The redesigned result row: matched text first, with thread metadata underneath.
export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="recent (no query)"
        hint="title + project · relative time"
      >
        <Stage>
          <ThreadSearchResultRow
            id="row-recent"
            isActive={false}
            matches={[]}
            onActive={noop}
            onSelect={noop}
            projectName="bb"
            thread={recentThread}
          />
        </Stage>
      </StoryRow>
      <StoryRow
        label="organized by folder"
        hint="title + folder (when Organize by = Folders) instead of project"
      >
        <Stage>
          <ThreadSearchResultRow
            id="row-folder"
            isActive={false}
            matches={[]}
            onActive={noop}
            onSelect={noop}
            projectName="bb"
            folderLabel="Infra › CI"
            thread={recentThread}
          />
        </Stage>
      </StoryRow>
      <StoryRow
        label="title match"
        hint="matched term highlighted in the title"
      >
        <Stage>
          <ThreadSearchResultRow
            id="row-title"
            isActive={false}
            matches={[
              {
                sourceKind: "title",
                text: getThreadDisplayTitle(titleMatchThread),
                highlightRanges: highlight(
                  getThreadDisplayTitle(titleMatchThread),
                  "permission",
                ),
                sourceSeq: null,
              },
            ]}
            onActive={noop}
            onSelect={noop}
            projectName="bb"
            thread={titleMatchThread}
          />
        </Stage>
      </StoryRow>
      <StoryRow
        label="message-body match"
        hint="matched snippet first; thread title, project, and relative time underneath"
      >
        <Stage>
          <ThreadSearchResultRow
            id="row-message"
            isActive={false}
            matches={[
              {
                sourceKind: "assistant_message",
                text: messageSnippet,
                highlightRanges: highlight(messageSnippet, "permission"),
                sourceSeq: 5,
              },
            ]}
            onActive={noop}
            onSelect={noop}
            projectName="bb"
            thread={messageMatchThread}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="personal thread" hint="no project — just relative time">
        <Stage>
          <ThreadSearchResultRow
            id="row-personal"
            isActive={false}
            matches={[]}
            onActive={noop}
            onSelect={noop}
            projectName={undefined}
            thread={personalThread}
          />
        </Stage>
      </StoryRow>
      <StoryRow
        label="active (keyboard-highlighted)"
        hint="aria-selected row state during arrow-key navigation"
      >
        <Stage>
          <ThreadSearchResultRow
            id="row-active"
            isActive
            matches={[]}
            onActive={noop}
            onSelect={noop}
            projectName="bb"
            thread={recentThread}
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
