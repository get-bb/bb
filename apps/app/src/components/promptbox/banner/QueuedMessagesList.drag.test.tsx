// @vitest-environment jsdom

import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@bb/domain";
import { QueuedMessagesList } from "./QueuedMessagesList";

// Lives in its own file rather than beside the rest of the QueuedMessagesList
// tests. It is the only test that drives a complete pointer gesture through
// @dnd-kit, and doing so leaves state behind that outlives the component:
// with it in the shared file, `toggles a few messages between the fitted
// drawer and collapsed modes` and `keeps an explicitly collapsed inline editor
// collapsed after dismissal` fail whenever vitest happens to order them after
// it. Skipping just this test made the other 36 pass. dnd-kit exposes no way to
// reset that state, so the file boundary — which vitest already isolates per
// worker — is the seam that contains it.

const noop = () => {};

function makeQueuedMessage(id: string, text: string): ThreadQueuedMessage {
  return {
    id,
    content: [{ type: "text", text, mentions: [] }],
    model: "gpt-5.5",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function rect({ top, bottom }: { top: number; bottom: number }) {
  return new DOMRect(0, top, 100, bottom - top);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("QueuedMessagesList group-handle drag", () => {
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
});
