// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  ThreadTitle,
  ThreadTitleMentionResourcesProvider,
} from "./ThreadTitleMentions";

afterEach(cleanup);

describe("ThreadTitle", () => {
  it("keeps mention pills while highlighting matched plain text", () => {
    const mentionedThread = makeThreadListEntry({
      id: "thr_mentioned",
      title: "Design review",
      titleFallback: "Design review",
    });
    const title = "Follow up on @thread:thr_mentioned auth";

    const { container } = render(
      <ThreadTitleMentionResourcesProvider
        sectionNamesById={new Map()}
        projectNamesById={new Map()}
        threadById={new Map([[mentionedThread.id, mentionedThread]])}
      >
        <ThreadTitle
          title={title}
          tooltip
          highlightRanges={[
            { start: title.indexOf("auth"), end: title.length },
          ]}
        />
      </ThreadTitleMentionResourcesProvider>,
    );

    expect(screen.getByText("Design review")).not.toBeNull();
    expect(container.textContent).not.toContain("@thread:thr_mentioned");
    expect(container.querySelector("mark")?.textContent).toBe("auth");
    expect(screen.getByTitle("Follow up on Design review auth")).not.toBeNull();
  });
});
