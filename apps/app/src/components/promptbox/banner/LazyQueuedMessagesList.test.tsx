// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ThreadQueuedMessage } from "@bb/domain";
import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import { afterEach, expect, it, vi } from "vitest";
import {
  LazyQueuedMessagesList,
  QueuedMessagesPendingCard,
} from "./LazyQueuedMessagesList";

const mocks = vi.hoisted(() => ({ imported: vi.fn() }));

vi.mock("./QueuedMessagesList", async (importOriginal) => {
  mocks.imported();
  return importOriginal();
});

afterEach(() => {
  cleanup();
});

const noop = () => {};

function Queue({
  queuedMessages,
}: {
  queuedMessages: readonly ThreadQueuedMessage[];
}) {
  return (
    <LazyQueuedMessagesList
      attachedToComposer
      queuedMessages={queuedMessages}
      sendAction="send-now"
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSend={noop}
      onReorder={noop}
      onSetGroupBoundary={noop}
      onEdit={noop}
      onDelete={noop}
    />
  );
}

it("downloads the queue only for queued work, warming it from the pending summary without mounting it", async () => {
  const view = render(<Queue queuedMessages={[]} />);
  await act(async () => {});
  expect(view.container.innerHTML).toBe("");
  expect(mocks.imported).not.toHaveBeenCalled();

  view.rerender(<QueuedMessagesPendingCard queuedMessageCount={2} />);
  await waitFor(() => expect(mocks.imported).toHaveBeenCalledOnce());
  await act(() => LazyQueuedMessagesList.preload());
  expect(mocks.imported).toHaveBeenCalledOnce();
  screen.getByRole("status", { name: "Loading queued messages" });
  expect(
    screen.queryByRole("button", { name: "Send queued message 1 now" }),
  ).toBeNull();

  view.rerender(
    <Queue
      queuedMessages={[
        makeThreadQueuedMessage({ id: "q_1" }),
        makeThreadQueuedMessage({ id: "q_2" }),
      ]}
    />,
  );
  expect(
    screen.queryByRole("status", { name: "Loading queued messages" }),
  ).toBeNull();
  screen.getByRole("button", { name: "Send queued message 1 now" });
  screen.getByRole("button", { name: "Reorder queued message 2" });
});
