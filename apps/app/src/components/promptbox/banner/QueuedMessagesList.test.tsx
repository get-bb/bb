// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { Active, DroppableContainer } from "@dnd-kit/core";
import {
  QueuedMessagesList,
  clampQueuedMessageDragTransform,
  queuedMessageCollisionDetection,
  queuedMessageSortingStrategy,
  resolveQueuedMessageDrag,
  snapGroupBoundaryDragTransform,
} from "./QueuedMessagesList";

const noop = () => {};

function makeQueuedMessage(id: string, text: string): ThreadQueuedMessage {
  return {
    id,
    content: [{ type: "text", text, mentions: [] }],
    model: "gpt-5.5",
    reasoningLevel: "medium",
    permissionMode: "workspace-write",
    serviceTier: "default",
    groupWithNext: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeQueuedFileMessage(id: string, name: string): ThreadQueuedMessage {
  return {
    ...makeQueuedMessage(id, ""),
    content: [
      {
        type: "localFile",
        path: `/tmp/${name}`,
        name,
      },
    ],
  };
}

function makeGroupedQueuedMessages(): ThreadQueuedMessage[] {
  return [
    {
      ...makeQueuedMessage("q_one", "First queued message"),
      groupWithNext: true,
    },
    makeQueuedMessage("q_two", "Second queued message"),
    makeQueuedMessage("q_three", "Third queued message"),
  ];
}

function rect({ top, bottom }: { top: number; bottom: number }) {
  return new DOMRect(0, top, 100, bottom - top);
}

function renderQueuedMessages(queuedMessages: readonly ThreadQueuedMessage[]) {
  return render(
    <QueuedMessagesList
      queuedMessages={queuedMessages}
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSendImmediately={noop}
      onReorder={noop}
      onSetGroupBoundary={noop}
      onEdit={noop}
      onDelete={noop}
    />,
  );
}

function renderQueuedMessagesWithOptions(
  queuedMessages: readonly ThreadQueuedMessage[],
  options: Pick<Parameters<typeof QueuedMessagesList>[0], "resolveMentionLink">,
) {
  return render(
    <QueuedMessagesList
      queuedMessages={queuedMessages}
      resolveMentionLink={options.resolveMentionLink}
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSendImmediately={noop}
      onReorder={noop}
      onSetGroupBoundary={noop}
      onEdit={noop}
      onDelete={noop}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("QueuedMessagesList", () => {
  it("cycles from drawer to workspace to collapsed with one header control", () => {
    const { container, getByRole } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ]);
    const header = container.querySelector<HTMLElement>(
      "[data-queued-messages-mode]",
    );

    expect(header?.getAttribute("data-queued-messages-mode")).toBe("drawer");
    expect(header?.className.split(/\s+/u)).toContain("border-b");
    expect(
      getByRole("button", { name: "Expand queued messages" }).querySelector(
        '[data-icon="ChevronUp"]',
      ),
    ).not.toBeNull();

    fireEvent.click(getByRole("button", { name: "Expand queued messages" }));
    expect(header?.getAttribute("data-queued-messages-mode")).toBe("workspace");
    expect(
      getByRole("button", { name: "Collapse queued messages" }).querySelector(
        '[data-icon="ChevronDown"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>(
        'section[aria-label="Queued messages"]',
      )?.style.height,
    ).toBe("240px");

    fireEvent.click(getByRole("button", { name: "Collapse queued messages" }));
    expect(header?.getAttribute("data-queued-messages-mode")).toBe("collapsed");
    expect(header?.className.split(/\s+/u)).not.toContain("border-b");
    expect(
      getByRole("button", { name: "Show queued messages" }).querySelector(
        '[data-icon="ChevronUp"]',
      ),
    ).not.toBeNull();

    fireEvent.click(getByRole("button", { name: "Show queued messages" }));
    expect(
      container
        .querySelector("[data-queued-messages-mode]")
        ?.getAttribute("data-queued-messages-mode"),
    ).toBe("drawer");
  });

  it("opens the workspace when the header handle is dragged up", () => {
    const { container, getByRole } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ]);
    const handle = getByRole("button", {
      name: "Drag up to open the queue workspace",
    });
    Object.defineProperty(handle, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 100, pointerId: 1 });

    expect(
      container
        .querySelector("[data-queued-messages-mode]")
        ?.getAttribute("data-queued-messages-mode"),
    ).toBe("workspace");
  });

  it("uses one hover-revealed overflow action and a grip-only drag handle", () => {
    const { container, getByRole } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
    ]);

    expect(
      getByRole("button", { name: "Queued message 1 actions" }).className,
    ).toContain("opacity-0");
    expect(
      container.querySelector('[data-icon="MoreHorizontal"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-icon="DragDropVertical"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-icon="ArrowTurnForward"]'),
    ).toBeNull();
  });

  it("replaces the edited row with the real-composer target", () => {
    const onComposerTargetChange = vi.fn();
    const onDismiss = vi.fn();
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ];

    const { container, getByRole, getByText } = render(
      <QueuedMessagesList
        queuedMessages={queuedMessages}
        inlineEditor={{
          queuedMessageId: "q_two",
          // Position is resolved from the stable message id, even if a stale
          // caller index arrives while the queue is changing.
          queuedMessageIndex: 0,
          ready: true,
          onComposerTargetChange,
          onDismiss,
        }}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSendImmediately={noop}
        onReorder={noop}
        onSetGroupBoundary={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(
      container.querySelector("[data-queued-message-inline-editor]"),
    ).not.toBeNull();
    const inlineEditorSlot = container.querySelector(
      "[data-queued-message-inline-editor]",
    );
    expect(
      inlineEditorSlot?.querySelector(
        '[data-overflow-fade="above"][data-overflow-fade-tone="surface-raised"]',
      ),
    ).not.toBeNull();
    expect(
      inlineEditorSlot?.querySelector(
        '[data-overflow-fade="below"][data-overflow-fade-tone="surface-raised"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("First queued message");
    expect(container.textContent).not.toContain("Second queued message");
    const queueItems = container.querySelectorAll("ul > li");
    expect(queueItems[0]?.textContent).toContain("First queued message");
    expect(
      Array.from(queueItems).some((item) =>
        item.hasAttribute("data-queued-message-inline-editor"),
      ),
    ).toBe(true);
    const editingLabel = getByText(/Editing queued message/u);
    const dismissButton = getByRole("button", {
      name: "Move editor back to the prompt box",
    });
    expect(editingLabel.parentElement?.className).toContain(
      "text-subtle-foreground",
    );
    expect(dismissButton.className).toContain("ml-auto");
    expect(dismissButton.className).toContain("size-6");
    expect(
      dismissButton.querySelector('[data-icon="X"]')?.getAttribute("class"),
    ).toContain("size-3");
    expect(onComposerTargetChange).toHaveBeenCalledWith(
      container.querySelector("[data-queued-message-composer-target]"),
    );

    fireEvent.click(
      getByRole("button", { name: "Move editor back to the prompt box" }),
    );
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("returns to the drawer height after inline editing ends", async () => {
    const queuedMessages = Array.from({ length: 4 }, (_, index) =>
      makeQueuedMessage(`q_${index}`, `Queued message ${index + 1}`),
    );
    const sharedProps = {
      queuedMessages,
      sendDisabled: false,
      actionDisabled: false,
      processingMessageId: null,
      processingAction: null,
      onSendImmediately: noop,
      onReorder: noop,
      onSetGroupBoundary: noop,
      onEdit: noop,
      onDelete: noop,
    } as const;
    const { container, rerender } = render(
      <QueuedMessagesList
        {...sharedProps}
        inlineEditor={{
          queuedMessageId: "q_0",
          queuedMessageIndex: 0,
          ready: true,
          onComposerTargetChange: noop,
          onDismiss: noop,
        }}
      />,
    );
    const surface = container.querySelector<HTMLElement>(
      'section[aria-label="Queued messages"]',
    );

    expect(surface?.style.height).toBe("320px");

    rerender(<QueuedMessagesList {...sharedProps} />);

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-queued-messages-mode]")
          ?.getAttribute("data-queued-messages-mode"),
      ).toBe("drawer");
      expect(surface?.style.height).toBe("174px");
    });
  });

  it("keeps an explicitly collapsed inline editor collapsed after dismissal", async () => {
    const onDismiss = vi.fn();
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ];
    const sharedProps = {
      queuedMessages,
      sendDisabled: false,
      actionDisabled: false,
      processingMessageId: null,
      processingAction: null,
      onSendImmediately: noop,
      onReorder: noop,
      onSetGroupBoundary: noop,
      onEdit: noop,
      onDelete: noop,
    } as const;
    const { container, getByRole, rerender } = render(
      <QueuedMessagesList
        {...sharedProps}
        inlineEditor={{
          queuedMessageId: "q_one",
          queuedMessageIndex: 0,
          ready: true,
          onComposerTargetChange: noop,
          onDismiss,
        }}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Collapse queued messages" }));
    expect(onDismiss).toHaveBeenCalledOnce();

    rerender(<QueuedMessagesList {...sharedProps} />);

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-queued-messages-mode]")
          ?.getAttribute("data-queued-messages-mode"),
      ).toBe("collapsed");
    });
  });

  it("renders queued blockquote markdown as a compact quote preview", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage(
        "q_quote",
        "> first quoted line\n> second quoted line\nreply underneath",
      ),
    ]);

    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("br")).toBeNull();
    expect(container.textContent?.replace(/\s+/gu, " ")).toContain(
      "first quoted line second quoted line reply underneath",
    );
    expect(container.textContent).not.toContain("> first quoted line");
  });

  it("renders queued markdown formatting instead of raw delimiters", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage(
        "q_markdown",
        "## Heading\nReview **bold** and `code`.",
      ),
    ]);

    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).toContain("Heading");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.textContent).not.toContain("## Heading");
    expect(container.textContent).not.toContain("**bold**");
    expect(container.textContent).not.toContain("`code`");
  });

  it("does not add hard-break elements for multi-line queued markdown", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage("q_multiline", "first line\nsecond line"),
    ]);

    expect(container.querySelector("br")).toBeNull();
    expect(container.textContent?.replace(/\s+/gu, " ")).toContain(
      "first line second line",
    );
  });

  it("does not render full markdown preview controls in queued rows", () => {
    const { container, queryByLabelText } = renderQueuedMessages([
      makeQueuedMessage("q_code_block", "```ts\nconst value = 1;\n```"),
    ]);

    expect(queryByLabelText("Copy code")).toBeNull();
    expect(queryByLabelText("Wrap long lines")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain(
      "const value = 1;",
    );
  });

  it("flattens images and links in queued markdown previews", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage(
        "q_media",
        "![Diagram](https://example.test/a.png) [docs](https://example.test)",
      ),
    ]);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a[href]")).toBeNull();
    expect(container.textContent).toContain("Diagram");
    expect(container.textContent).toContain("docs");
  });

  it("renders attachment-only fallback text literally", () => {
    const { container } = renderQueuedMessages([
      makeQueuedFileMessage("q_attachment", "[notes](https://example.test).md"),
    ]);

    expect(container.querySelector("a[href]")).toBeNull();
    expect(container.textContent).toContain(
      "Attachment only ([notes](https://example.test).md)",
    );
  });

  it("shows a FileAttachment icon instead of attachment prose", () => {
    const queuedMessage = makeQueuedMessage(
      "q_attachment_icon",
      "Review the attached screenshot",
    );
    queuedMessage.content.push({
      type: "localFile",
      path: "/tmp/screenshot.png",
      name: "screenshot.png",
    });

    const { container, getByRole } = renderQueuedMessages([queuedMessage]);

    expect(getByRole("img", { name: "1 attachment" }).textContent).toBe("1");
    expect(
      container.querySelector('[data-icon="FileAttachment"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("1 attachment");
  });

  it("renders prompt mentions as pills in queued previews", () => {
    const text =
      "Run /goal and open @apps/app/src/foo.ts from @thread:thr_prompt_pills";
    const commandToken = "/goal";
    const pathToken = "@apps/app/src/foo.ts";
    const threadToken = "@thread:thr_prompt_pills";
    const commandStart = text.indexOf(commandToken);
    const pathStart = text.indexOf(pathToken);
    const threadStart = text.indexOf(threadToken);
    const openPath = vi.fn();

    const { container, getByText } = renderQueuedMessagesWithOptions(
      [
        {
          ...makeQueuedMessage("q_mentions", text),
          content: [
            {
              type: "text",
              text,
              mentions: [
                {
                  start: commandStart,
                  end: commandStart + commandToken.length,
                  resource: {
                    kind: "command",
                    trigger: "/",
                    name: "goal",
                    source: "command",
                    origin: "user",
                    label: "goal",
                    argumentHint: null,
                  },
                },
                {
                  start: pathStart,
                  end: pathStart + pathToken.length,
                  resource: {
                    kind: "path",
                    source: "workspace",
                    entryKind: "file",
                    path: "apps/app/src/foo.ts",
                    label: "foo.ts",
                  },
                },
                {
                  start: threadStart,
                  end: threadStart + threadToken.length,
                  resource: {
                    kind: "thread",
                    threadId: "thr_prompt_pills",
                    label: "Prompt pills QA",
                  },
                },
              ],
            },
          ],
        },
      ],
      {
        resolveMentionLink: (resource) =>
          resource.kind === "path" ? openPath : null,
      },
    );

    expect(container.querySelectorAll(".prompt-mention-pill")).toHaveLength(3);
    expect(container.querySelector('[data-icon="Target"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="File"]')).not.toBeNull();
    expect(
      container.querySelector('[data-icon="MessageSquare"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Run goal and open foo.ts from Prompt pills QA",
    );
    expect(container.textContent).not.toContain(commandToken);
    expect(container.textContent).not.toContain(pathToken);
    expect(container.textContent).not.toContain(threadToken);

    fireEvent.click(getByText("foo.ts"));

    expect(openPath).toHaveBeenCalledTimes(1);
  });

  it("shows a bottom fade when the expanded queue overflows", async () => {
    const { container } = renderQueuedMessages(
      Array.from({ length: 8 }, (_, index) =>
        makeQueuedMessage(
          `q_${index}`,
          `Queued follow-up ${index}: check the compact scroll fade.`,
        ),
      ),
    );
    const scroll = container.querySelector<HTMLDivElement>(
      "[data-queued-messages-scroll]",
    );
    expect(scroll).not.toBeNull();
    if (!scroll) return;

    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 96,
    });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.scroll(scroll);

    await waitFor(() => {
      const fade = container.querySelector(
        '[data-overflow-fade="below"][data-overflow-fade-tone="surface-raised"][data-overflow-fade-inset]',
      );
      expect(fade).not.toBeNull();
      expect(fade?.className).toContain("h-6");
      expect(fade?.className).toContain("bottom-0");
    });
  });

  it("renders the draggable group divider without filling grouped rows", () => {
    const { container, getByLabelText } = renderQueuedMessages(
      makeGroupedQueuedMessages(),
    );

    expect(getByLabelText("Messages above send together")).not.toBeNull();
    expect(container.textContent).not.toContain("grouped");
    expect(
      container.querySelectorAll("[data-queued-message-row]"),
    ).toHaveLength(3);
    expect(
      container.querySelector("[data-queued-message-group-fill]"),
    ).toBeNull();
    const divider = container.querySelector(
      "[data-queued-message-group-divider]",
    );
    expect(divider?.tagName).toBe("LI");
    expect(divider?.className).toContain("h-0");
    expect(divider?.parentElement?.tagName).toBe("UL");
  });

  it("keeps the final row stroke when every queued message is grouped", () => {
    const queuedMessages = [
      {
        ...makeQueuedMessage("q_one", "First queued message"),
        groupWithNext: true,
      },
      {
        ...makeQueuedMessage("q_two", "Second queued message"),
        groupWithNext: true,
      },
      makeQueuedMessage("q_three", "Third queued message"),
    ];
    const { container, getByLabelText } = renderQueuedMessages(queuedMessages);
    const rows = container.querySelectorAll("[data-queued-message-row]");
    const finalRow = rows[2];
    const divider = finalRow?.nextElementSibling;

    expect(finalRow?.className).toContain("border-b");
    expect(finalRow?.className).not.toContain("last:border-b-0");
    expect(divider?.hasAttribute("data-queued-message-group-divider")).toBe(
      true,
    );
    expect(divider?.firstElementChild?.className).toContain("top-[-0.5px]");
    expect(getByLabelText("Messages above send together")).not.toBeNull();
  });

  it("anchors a zero-height sortable handle sibling to the existing row border", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ]);
    const rows = container.querySelectorAll("[data-queued-message-row]");

    expect(rows[0]?.className).toContain("border-b");
    expect(rows[1]?.className).toContain("border-b");
    const divider = container.querySelector(
      "ul > [data-queued-message-group-divider]",
    );
    expect(divider).not.toBeNull();
    expect(divider?.previousElementSibling).toBe(rows[0]);
    expect(divider?.className).toContain("h-0");
    expect(rows[0]?.querySelector("[data-queued-message-group-divider]")).toBe(
      null,
    );
    expect(rows[1]?.querySelector("[data-queued-message-group-divider]")).toBe(
      null,
    );
    expect(container.querySelector("[data-queued-message-group-line]")).toBe(
      null,
    );
  });

  it("shows a subtle grip at rest and reveals its circular target on row focus or hover", () => {
    const { getByLabelText } = renderQueuedMessages(
      makeGroupedQueuedMessages(),
    );
    const control = getByLabelText("Messages above send together");
    const grip = control.querySelector('[data-icon="DragDropHorizontal"]');

    expect(control.className).toContain("border-transparent");
    expect(control.className).toContain("bg-transparent");
    expect(control.className).toContain(
      "group-has-[[data-queued-message-group-boundary-row]:hover]/queue:border-border",
    );
    expect(control.className).toContain(
      "group-has-[[data-queued-message-group-boundary-row]:focus-within]/queue:bg-background",
    );
    expect(grip?.getAttribute("class")).toContain("opacity-55");
    expect(grip?.getAttribute("class")).toContain(
      "group-has-[[data-queued-message-group-boundary-row]:hover]/queue:opacity-100",
    );
  });

  it("preserves grouping when reordering a row across the divider", () => {
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];

    const result = resolveQueuedMessageDrag({
      activeId: "q_three",
      overId: "q_one",
      combinedIds: [
        "q_one",
        "__queued_message_group_divider__",
        "q_two",
        "q_three",
      ],
      orderedMessages: queuedMessages,
    });

    expect(result).toMatchObject({
      kind: "row",
      request: {
        queuedMessageId: "q_three",
        previousQueuedMessageId: null,
        nextQueuedMessageId: "q_one",
      },
      orderedMessages: [
        { id: "q_three", groupWithNext: false },
        { id: "q_one", groupWithNext: false },
        { id: "q_two", groupWithNext: false },
      ],
    });
    if (result?.kind !== "row") {
      throw new Error("Expected row drag result");
    }
    expect(result.request.groupBoundaryQueuedMessageId).toBeUndefined();
  });

  it("updates grouping when dragging the divider", () => {
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];

    expect(
      resolveQueuedMessageDrag({
        activeId: "__queued_message_group_divider__",
        overId: "q_three",
        combinedIds: [
          "q_one",
          "__queued_message_group_divider__",
          "q_two",
          "q_three",
        ],
        orderedMessages: queuedMessages,
      }),
    ).toMatchObject({
      kind: "divider",
      request: {
        expectedGroupedPrefixQueuedMessageIds: ["q_one", "q_two", "q_three"],
        groupBoundaryQueuedMessageId: "q_three",
      },
      orderedMessages: [
        { id: "q_one", groupWithNext: true },
        { id: "q_two", groupWithNext: true },
        { id: "q_three", groupWithNext: false },
      ],
    });
  });

  it("drags the zero-height group handle to a measured row stroke", async () => {
    const onSetGroupBoundary = vi.fn();
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];
    const { container, getByLabelText } = render(
      <QueuedMessagesList
        queuedMessages={queuedMessages}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSendImmediately={noop}
        onReorder={noop}
        onSetGroupBoundary={onSetGroupBoundary}
        onEdit={noop}
        onDelete={noop}
      />,
    );
    const rows = container.querySelectorAll<HTMLElement>(
      "[data-queued-message-row]",
    );
    const divider = container.querySelector<HTMLElement>(
      "[data-queued-message-group-divider]",
    );
    const list = container.querySelector<HTMLElement>("ul");
    const scroll = container.querySelector<HTMLElement>(
      "[data-queued-messages-scroll]",
    );
    expect(divider).not.toBeNull();
    expect(list).not.toBeNull();
    expect(scroll).not.toBeNull();

    const measuredRects = [
      rect({ top: 0, bottom: 40 }),
      rect({ top: 40, bottom: 72 }),
      rect({ top: 72, bottom: 112 }),
    ];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => measuredRects[index]!;
    });
    divider!.getBoundingClientRect = () => rect({ top: 40, bottom: 40 });
    list!.getBoundingClientRect = () => rect({ top: 0, bottom: 116 });
    scroll!.getBoundingClientRect = () => rect({ top: 0, bottom: 160 });

    const handle = getByLabelText("Messages above send together");
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 50,
      clientY: 40,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, {
      clientX: 50,
      clientY: 46,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, {
      clientX: 50,
      clientY: 108,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(document, {
      clientX: 50,
      clientY: 108,
      isPrimary: true,
      pointerId: 1,
    });

    await waitFor(() =>
      expect(onSetGroupBoundary).toHaveBeenCalledWith({
        expectedGroupedPrefixQueuedMessageIds: ["q_one", "q_two", "q_three"],
        groupBoundaryQueuedMessageId: "q_three",
      }),
    );
  });

  it("clamps queued-message drags to the rendered list bottom", () => {
    expect(
      clampQueuedMessageDragTransform({
        draggingNodeRect: rect({ top: 24, bottom: 40 }),
        listRect: rect({ top: 0, bottom: 72 }),
        scrollRect: rect({ top: 0, bottom: 128 }),
        transform: { x: 12, y: 96, scaleX: 1, scaleY: 1 },
      }),
    ).toEqual({ x: 0, y: 32, scaleX: 1, scaleY: 1 });
  });

  it("snaps the group handle center to the hovered row stroke", () => {
    expect(
      snapGroupBoundaryDragTransform({
        activeId: "__queued_message_group_divider__",
        activeNodeRect: rect({ top: 28, bottom: 52 }),
        overId: "q_three",
        overRect: rect({ top: 72, bottom: 112 }),
        transform: { x: 8, y: 51, scaleX: 1, scaleY: 1 },
      }),
    ).toEqual({ x: 0, y: 72, scaleX: 1, scaleY: 1 });
  });

  it("keeps ordinary row drags continuous", () => {
    const transform = { x: 8, y: 51, scaleX: 1, scaleY: 1 };

    expect(
      snapGroupBoundaryDragTransform({
        activeId: "q_two",
        activeNodeRect: rect({ top: 28, bottom: 52 }),
        overId: "q_three",
        overRect: rect({ top: 72, bottom: 112 }),
        transform,
      }),
    ).toBe(transform);
  });

  it("lets the group handle leave its own collision target before snapping", () => {
    expect(
      snapGroupBoundaryDragTransform({
        activeId: "__queued_message_group_divider__",
        activeNodeRect: rect({ top: 28, bottom: 52 }),
        overId: "__queued_message_group_divider__",
        overRect: rect({ top: 28, bottom: 52 }),
        transform: { x: 8, y: 18, scaleX: 1, scaleY: 1 },
      }),
    ).toEqual({ x: 0, y: 18, scaleX: 1, scaleY: 1 });
  });

  it("chooses group-boundary targets from pointer distance to row strokes", () => {
    const makeContainer = (id: string): DroppableContainer => ({
      data: { current: undefined },
      disabled: false,
      id,
      key: id,
      node: { current: null },
      rect: { current: null },
    });
    const containers = [
      makeContainer("q_one"),
      makeContainer("__queued_message_group_divider__"),
      makeContainer("q_two"),
      makeContainer("q_three"),
    ];
    const collisions = queuedMessageCollisionDetection({
      active: {
        data: { current: undefined },
        id: "__queued_message_group_divider__",
        rect: { current: { initial: null, translated: null } },
      } satisfies Active,
      collisionRect: rect({ top: 28, bottom: 52 }),
      droppableContainers: containers,
      droppableRects: new Map([
        ["q_one", rect({ top: 0, bottom: 40 })],
        ["__queued_message_group_divider__", rect({ top: 28, bottom: 52 })],
        ["q_two", rect({ top: 40, bottom: 72 })],
        ["q_three", rect({ top: 72, bottom: 112 })],
      ]),
      pointerCoordinates: { x: 50, y: 75 },
    });

    expect(collisions.map((collision) => collision.id)).toEqual([
      "q_two",
      "q_one",
      "q_three",
    ]);
  });

  it("keeps message row geometry fixed while dragging the group handle", () => {
    const rects = [
      rect({ top: 0, bottom: 40 }),
      rect({ top: 40, bottom: 64 }),
      rect({ top: 64, bottom: 104 }),
    ];

    expect(
      queuedMessageSortingStrategy(
        ["q_one", "__queued_message_group_divider__", "q_two"],
        {
          activeNodeRect: rects[1]!,
          activeIndex: 1,
          index: 2,
          overIndex: 2,
          rects,
        },
      ),
    ).toBeNull();

    expect(
      queuedMessageSortingStrategy(
        ["q_one", "__queued_message_group_divider__", "q_two"],
        {
          activeNodeRect: rects[0]!,
          activeIndex: 0,
          index: 1,
          overIndex: 1,
          rects,
        },
      ),
    ).not.toBeNull();
  });

  it("re-adopts queued-message order from props when the same rows are restored", () => {
    const originalMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];
    const { container, rerender } = renderQueuedMessages(originalMessages);

    rerender(
      <QueuedMessagesList
        queuedMessages={[
          originalMessages[1]!,
          originalMessages[0]!,
          originalMessages[2]!,
        ]}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSendImmediately={noop}
        onReorder={noop}
        onSetGroupBoundary={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );
    expect(
      Array.from(container.querySelectorAll("[data-queued-message-row]")).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Second queued message"),
      expect.stringContaining("First queued message"),
      expect.stringContaining("Third queued message"),
    ]);

    rerender(
      <QueuedMessagesList
        queuedMessages={originalMessages}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSendImmediately={noop}
        onReorder={noop}
        onSetGroupBoundary={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(
      Array.from(container.querySelectorAll("[data-queued-message-row]")).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      expect.stringContaining("First queued message"),
      expect.stringContaining("Second queued message"),
      expect.stringContaining("Third queued message"),
    ]);
  });

  it("does not show a fade when stale observer entries report hidden sentinels without overflow", async () => {
    interface ObserverControl {
      targets: Element[];
      trigger(entries: readonly Partial<IntersectionObserverEntry>[]): void;
    }

    const observers: ObserverControl[] = [];

    class IntersectionObserverMock implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly scrollMargin = "";
      readonly thresholds = [0];
      readonly targets: Element[] = [];

      constructor(private readonly callback: IntersectionObserverCallback) {
        observers.push(this);
      }

      disconnect() {}

      observe(target: Element) {
        this.targets.push(target);
      }

      takeRecords() {
        return [];
      }

      trigger(entries: readonly Partial<IntersectionObserverEntry>[]) {
        this.callback(entries as IntersectionObserverEntry[], this);
      }

      unobserve() {}
    }

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const { container } = renderQueuedMessages([
      makeQueuedMessage("q_one", "single queued message"),
    ]);
    const scroll = container.querySelector<HTMLDivElement>(
      "[data-queued-messages-scroll]",
    );
    expect(scroll).not.toBeNull();
    if (!scroll) return;

    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 48,
    });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 48,
    });

    await waitFor(() => {
      expect(observers[0]?.targets).toHaveLength(2);
    });

    const currentObserver = observers[0];
    expect(currentObserver).toBeDefined();
    if (!currentObserver) return;

    const [topSentinel, bottomSentinel] = currentObserver.targets;
    expect(topSentinel).toBeDefined();
    expect(bottomSentinel).toBeDefined();
    if (!topSentinel || !bottomSentinel) return;

    act(() => {
      currentObserver.trigger([
        { target: topSentinel, isIntersecting: false },
        { target: bottomSentinel, isIntersecting: false },
      ]);
    });

    expect(container.querySelector('[data-overflow-fade="above"]')).toBeNull();
    expect(container.querySelector('[data-overflow-fade="below"]')).toBeNull();
  });
});
