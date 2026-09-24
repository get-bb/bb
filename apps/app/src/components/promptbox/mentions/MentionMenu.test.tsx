// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptMentionSuggestion } from "@bb/client-core";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { MentionMenu } from "./MentionMenu";

afterEach(cleanup);

describe("MentionMenu", () => {
  it("renders serialized thread mentions in thread titles as non-interactive pills", () => {
    const mentionedThread = makeThreadListEntry({
      id: "thr_mentioned",
      projectId: "proj_mentioned",
      title: "Mention target",
      titleFallback: "Mention target",
    });
    const suggestion: PromptMentionSuggestion = {
      kind: "thread",
      path: "thr_source",
      replacement: "@thread:thr_source",
      projectId: "proj_mentioned",
      threadId: "thr_source",
      title: "Continue from @thread:thr_mentioned",
      relation: null,
    };
    const onApply = vi.fn();

    render(
      <ThreadTitleMentionResourcesProvider
        sectionNamesById={new Map()}
        projectNamesById={new Map()}
        threadById={new Map([[mentionedThread.id, mentionedThread]])}
      >
        <MentionMenu
          state={{
            trigger: "mention",
            state: {
              kind: "results",
              results: {
                groups: [
                  {
                    key: "threads",
                    label: "Threads",
                    startIndex: 0,
                    suggestions: [suggestion],
                  },
                ],
                suggestions: [suggestion],
              },
            },
          }}
          selectedIndex={0}
          onApply={onApply}
        />
      </ThreadTitleMentionResourcesProvider>,
    );

    expect(screen.queryByText(/@thread:thr_mentioned/)).toBeNull();
    const pill = screen.getByText("Mention target");
    expect(pill.closest("a")).toBeNull();
    expect(pill.closest("[role='link']")).toBeNull();
    expect(screen.getByTitle("Continue from Mention target")).not.toBeNull();
  });
});
