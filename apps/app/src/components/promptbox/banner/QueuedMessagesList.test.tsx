// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@bb/domain";
import {
  applyQueuedMessageReorder,
  buildQueuedMessageReorderRequest,
} from "@/lib/queued-message-reorder";
import {
  QueuedMessagesList,
  type QueuedMessagesListProps,
} from "./QueuedMessagesList";

function makeQueuedMessage(id: string, text: string): ThreadQueuedMessage {
  return {
    id,
    content: [{ type: "text", text, mentions: [] }],
    model: "gpt-5",
    reasoningLevel: "medium",
    permissionMode: "full",
    serviceTier: "default",
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeQueuedMessagesListProps(
  props: Partial<QueuedMessagesListProps> = {},
): QueuedMessagesListProps {
  return {
    queuedMessages: [
      makeQueuedMessage("qmsg_1", "First queued message"),
      makeQueuedMessage("qmsg_2", "Second queued message"),
      makeQueuedMessage("qmsg_3", "Third queued message"),
    ],
    sendDisabled: false,
    actionDisabled: false,
    processingMessageId: null,
    processingAction: null,
    onSendImmediately: vi.fn(),
    onReorder: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...props,
  };
}

function expectButtonToBeDisabled(label: string): void {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${label} to be a button`);
  }
  expect(element.disabled).toBe(true);
}

afterEach(() => {
  cleanup();
});

describe("QueuedMessagesList", () => {
  it("builds reorder neighbor requests from dragged item positions", () => {
    const queuedMessages = [
      makeQueuedMessage("qmsg_1", "First queued message"),
      makeQueuedMessage("qmsg_2", "Second queued message"),
      makeQueuedMessage("qmsg_3", "Third queued message"),
    ];

    expect(
      buildQueuedMessageReorderRequest({
        activeId: "qmsg_3",
        overId: "qmsg_1",
        queuedMessages,
      }),
    ).toEqual({
      queuedMessageId: "qmsg_3",
      previousQueuedMessageId: null,
      nextQueuedMessageId: "qmsg_1",
    });
    expect(
      buildQueuedMessageReorderRequest({
        activeId: "qmsg_1",
        overId: "qmsg_3",
        queuedMessages,
      }),
    ).toEqual({
      queuedMessageId: "qmsg_1",
      previousQueuedMessageId: "qmsg_3",
      nextQueuedMessageId: null,
    });
  });

  it("applies queued message reorder requests consistently", () => {
    const queuedMessages = [
      makeQueuedMessage("qmsg_1", "First queued message"),
      makeQueuedMessage("qmsg_2", "Second queued message"),
      makeQueuedMessage("qmsg_3", "Third queued message"),
    ];

    expect(
      applyQueuedMessageReorder({
        queuedMessages,
        request: {
          queuedMessageId: "qmsg_3",
          previousQueuedMessageId: null,
          nextQueuedMessageId: "qmsg_1",
        },
      }).map((queuedMessage) => queuedMessage.id),
    ).toEqual(["qmsg_3", "qmsg_1", "qmsg_2"]);
    expect(
      applyQueuedMessageReorder({
        queuedMessages,
        request: {
          queuedMessageId: "qmsg_1",
          previousQueuedMessageId: "qmsg_3",
          nextQueuedMessageId: null,
        },
      }).map((queuedMessage) => queuedMessage.id),
    ).toEqual(["qmsg_2", "qmsg_3", "qmsg_1"]);
    expect(
      applyQueuedMessageReorder({
        queuedMessages,
        request: {
          queuedMessageId: "qmsg_2",
          previousQueuedMessageId: null,
          nextQueuedMessageId: null,
        },
      }).map((queuedMessage) => queuedMessage.id),
    ).toEqual(["qmsg_2", "qmsg_1", "qmsg_3"]);
  });

  it("keeps row actions independent from the reorder handle", () => {
    const onSendImmediately = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <QueuedMessagesList
        {...makeQueuedMessagesListProps({
          onSendImmediately,
          onEdit,
          onDelete,
        })}
      />,
    );

    const sendButton = screen.getAllByRole("button", { name: "Send now" })[0];
    if (!sendButton) {
      throw new Error("Expected queued message send button");
    }
    fireEvent.click(sendButton);
    fireEvent.click(screen.getByLabelText("Edit queued message 1"));
    fireEvent.click(screen.getByLabelText("Delete queued message 1"));

    expect(onSendImmediately).toHaveBeenCalledWith("qmsg_1");
    expect(onEdit).toHaveBeenCalledWith("qmsg_1");
    expect(onDelete).toHaveBeenCalledWith("qmsg_1");
  });

  it("disables sorting for one item and while processing", () => {
    const singleQueuedMessage = makeQueuedMessage(
      "qmsg_single",
      "Only queued message",
    );
    const { rerender } = render(
      <QueuedMessagesList
        {...makeQueuedMessagesListProps({
          queuedMessages: [singleQueuedMessage],
        })}
      />,
    );

    expectButtonToBeDisabled("Reorder queued message 1");

    rerender(
      <QueuedMessagesList
        {...makeQueuedMessagesListProps({
          processingMessageId: "qmsg_2",
        })}
      />,
    );

    expectButtonToBeDisabled("Reorder queued message 1");
    expectButtonToBeDisabled("Reorder queued message 2");
    expectButtonToBeDisabled("Reorder queued message 3");
  });
});
