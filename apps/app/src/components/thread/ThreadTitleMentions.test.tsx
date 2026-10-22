// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  ThreadTitle,
  ThreadTitleMentionResourcesProvider,
  useThreadTitleDisplayText,
} from "./ThreadTitleMentions";

afterEach(cleanup);

function DisplayText({ title }: { title: string }) {
  return (
    <span data-testid="display-text">{useThreadTitleDisplayText(title)}</span>
  );
}

describe("ThreadTitle", () => {
  it("renders serialized thread mentions in a title as non-interactive pills", () => {
    const mentionedThread = makeThreadListEntry({
      id: "thr_mentioned",
      projectId: "proj_mentioned",
      title: "Mention target",
      titleFallback: "Mention target",
    });
    const title = "Continue from @thread:thr_mentioned";

    render(
      <ThreadTitleMentionResourcesProvider
        sectionNamesById={new Map()}
        projectNamesById={new Map()}
        threadById={new Map([[mentionedThread.id, mentionedThread]])}
      >
        <ThreadTitle title={title} />
        <DisplayText title={title} />
      </ThreadTitleMentionResourcesProvider>,
    );

    expect(screen.queryByText(/@thread:thr_mentioned/)).toBeNull();
    const pill = screen.getByText("Mention target");
    expect(pill.closest("a")).toBeNull();
    expect(pill.closest("[role='link']")).toBeNull();
    expect(screen.getByTestId("display-text").textContent).toBe(
      "Continue from Mention target",
    );
  });
});
