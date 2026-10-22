// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composerMentionSuggestionFromPrompt,
  type PromptMentionSuggestion,
} from "@bb/client-core";
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
              refreshing: false,
              groups: [
                {
                  key: "threads",
                  label: "Threads",
                  suggestions: [
                    composerMentionSuggestionFromPrompt(suggestion),
                  ],
                },
              ],
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

  it("shows a refresh spinner over current results without changing their layout", () => {
    const suggestion: PromptMentionSuggestion = {
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "src/index.ts",
      name: "index.ts",
      replacement: "@src/index.ts",
    };
    const renderMenu = (refreshing: boolean) =>
      render(
        <MentionMenu
          state={{
            trigger: "mention",
            state: {
              kind: "results",
              refreshing,
              groups: [
                {
                  key: "workspace",
                  label: "Workspace",
                  suggestions: [
                    composerMentionSuggestionFromPrompt(suggestion),
                  ],
                },
              ],
            },
          }}
          selectedIndex={0}
          onApply={vi.fn()}
        />,
      );

    const idle = renderMenu(false);
    const idleStatus = idle.container.querySelector("[role='status']");
    expect(idleStatus?.classList.contains("invisible")).toBe(true);
    expect(screen.queryByLabelText("Updating results")).toBeNull();
    idle.unmount();

    const refreshing = renderMenu(true);
    const refreshingStatus =
      refreshing.container.querySelector("[role='status']");
    expect(refreshingStatus?.classList.contains("invisible")).toBe(false);
    expect(screen.getByLabelText("Updating results")).toBe(refreshingStatus);
    expect(screen.getByText("index.ts")).not.toBeNull();
  });
});
