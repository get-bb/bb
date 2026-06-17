import { describe, expect, it } from "vitest";
import {
  buildChildThreadNeedsAttentionInput,
  buildChildThreadTurnStatusBatchInput,
  renderChildThreadTurnStatusBatchMessage,
  type ChildThreadNotificationSource,
} from "../../../src/services/threads/child-thread-notifications.js";

interface TestThreadArgs {
  id: string;
  title: string | null;
}

function testThread(args: TestThreadArgs): ChildThreadNotificationSource {
  return {
    id: args.id,
    projectId: "proj_alpha",
    title: args.title,
  };
}

describe("child thread notifications", () => {
  it("keeps final output for a single completed outcome", () => {
    const message = renderChildThreadTurnStatusBatchMessage({
      items: [
        {
          childThread: testThread({
            id: "thr_child",
            title: "Fix checkout flow",
          }),
          terminalOutput: "Implemented the requested change.",
          turnStatus: "completed",
        },
      ],
    });

    expect(message).toContain(
      [
        "@thread:thr_child completed:",
        "",
        "Implemented the requested change.",
      ].join("\n"),
    );
    expect(message).not.toContain("Child thread updates:");
  });

  it("omits output for a single failed outcome", () => {
    const message = renderChildThreadTurnStatusBatchMessage({
      items: [
        {
          childThread: testThread({
            id: "thr_child",
            title: "Patch deploy script",
          }),
          terminalOutput: "Deploy script failed on preflight.",
          turnStatus: "failed",
        },
      ],
    });

    expect(message).toContain(
      ["@thread:thr_child failed.", "", "Review the thread before deciding next steps."].join(
        "\n",
      ),
    );
    expect(message).not.toContain("Deploy script failed on preflight.");
  });

  it("omits output and preserves manual-stop safety guidance for a single interrupted outcome", () => {
    const message = renderChildThreadTurnStatusBatchMessage({
      items: [
        {
          childThread: testThread({
            id: "thr_child",
            title: "Fix checkout flow",
          }),
          terminalOutput: "Stopped after writing the checkout summary.",
          turnStatus: "interrupted",
        },
      ],
    });

    expect(message).toContain(
      [
        "@thread:thr_child was interrupted.",
        "",
        "Review the thread before deciding next steps.",
        "",
        "If the user stopped it manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.",
      ].join("\n"),
    );
    expect(message).not.toContain("Child thread updates:");
    expect(message).not.toContain("Stopped after writing the checkout summary.");
  });

  it("renders multiple child outcomes as status-only bullet lines", () => {
    const message = renderChildThreadTurnStatusBatchMessage({
      items: [
        {
          childThread: testThread({
            id: "thr_child_one",
            title: "Fix checkout flow",
          }),
          terminalOutput: "Checkout flow is fixed.",
          turnStatus: "completed",
        },
        {
          childThread: testThread({
            id: "thr_child_two",
            title: "Patch deploy script",
          }),
          terminalOutput: "Deploy script failed on preflight.",
          turnStatus: "failed",
        },
      ],
    });

    expect(message).toContain(
      [
        "[bb system]",
        "",
        "Child thread updates:",
        "",
        "- @thread:thr_child_one completed.",
        "- @thread:thr_child_two failed.",
      ].join("\n"),
    );
    expect(message).not.toContain("Checkout flow is fixed.");
    expect(message).not.toContain("Deploy script failed on preflight.");
  });

  it("builds mention ranges for batched outcome thread references", () => {
    const input = buildChildThreadTurnStatusBatchInput({
      items: [
        {
          childThread: testThread({
            id: "thr_child_one",
            title: "Fix checkout flow",
          }),
          terminalOutput: "Checkout flow is fixed.",
          turnStatus: "completed",
        },
        {
          childThread: testThread({
            id: "thr_child_two",
            title: null,
          }),
          terminalOutput: "Deploy script failed.",
          turnStatus: "failed",
        },
      ],
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }
    expect(textInput).toEqual({
      type: "text",
      text: expect.stringContaining("@thread:thr_child_one"),
      mentions: [
        {
          start: expect.any(Number),
          end: expect.any(Number),
          resource: {
            kind: "thread",
            label: "Fix checkout flow",
            projectId: "proj_alpha",
            threadId: "thr_child_one",
          },
        },
        {
          start: expect.any(Number),
          end: expect.any(Number),
          resource: {
            kind: "thread",
            label: "thr_child_two",
            projectId: "proj_alpha",
            threadId: "thr_child_two",
          },
        },
      ],
    });
    expect(textInput.text).toContain("@thread:thr_child_two");
    expect(textInput.text).toContain("Child thread updates:");
    expect(
      textInput.mentions.map((mention) =>
        textInput.text.slice(mention.start, mention.end),
      ),
    ).toEqual(["@thread:thr_child_one", "@thread:thr_child_two"]);
  });

  it("does not render raw title suffixes next to rich thread mentions", () => {
    const nestedToken = "@thread:thr_child_two";
    const input = buildChildThreadTurnStatusBatchInput({
      items: [
        {
          childThread: testThread({
            id: "thr_child_one",
            title: `Title mentions ${nestedToken}`,
          }),
          terminalOutput: "Checkout flow is fixed.",
          turnStatus: "completed",
        },
        {
          childThread: testThread({
            id: "thr_child_two",
            title: "Second thread",
          }),
          terminalOutput: "Deploy script failed.",
          turnStatus: "failed",
        },
      ],
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }

    const secondLineTokenStart = textInput.text.lastIndexOf(nestedToken);
    expect(textInput.text).not.toContain("Title mentions");
    expect(textInput.mentions.map((mention) => mention.start)).toEqual([
      textInput.text.indexOf("@thread:thr_child_one"),
      secondLineTokenStart,
    ]);
    expect(
      textInput.mentions.map((mention) =>
        textInput.text.slice(mention.start, mention.end),
      ),
    ).toEqual(["@thread:thr_child_one", nestedToken]);
  });

  it("renders a final output fallback for a completed child without output", () => {
    const message = renderChildThreadTurnStatusBatchMessage({
      items: [
        {
          childThread: testThread({
            id: "thr_child",
            title: "Patch deploy script",
          }),
          terminalOutput: null,
          turnStatus: "completed",
        },
      ],
    });

    expect(message).toContain(
      ["@thread:thr_child completed:", "", "No final output was recorded."].join(
        "\n",
      ),
    );
  });

  it("builds mention ranges for needs-attention thread references", () => {
    const input = buildChildThreadNeedsAttentionInput({
      blockerSummary: null,
      childThread: testThread({
        id: "thr_child",
        title: "Backend cleanup",
      }),
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }
    const threadMention = "@thread:thr_child";
    const mentionStart = textInput.text.indexOf(threadMention);
    expect(textInput.mentions).toEqual([
      {
        start: mentionStart,
        end: mentionStart + threadMention.length,
        resource: {
          kind: "thread",
          label: "Backend cleanup",
          projectId: "proj_alpha",
          threadId: "thr_child",
        },
      },
    ]);
    expect(textInput.text).toContain(
      "Review the blocker. If you can resolve it from existing context, reply to the thread with guidance.",
    );
  });

  it("renders needs-attention blocker summaries when provided", () => {
    const input = buildChildThreadNeedsAttentionInput({
      blockerSummary: ["Blocked on command approval:", "git push"].join("\n"),
      childThread: testThread({
        id: "thr_child",
        title: "Backend cleanup",
      }),
    });

    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }

    expect(textInput.text).toContain(
      ["Blocked on command approval:", "git push"].join("\n"),
    );
    expect(textInput.text).not.toContain(
      "It is blocked on a pending interaction.",
    );
  });
});
