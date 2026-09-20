// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  getPendingThreadMessages,
  retainThreadMessage,
  removePendingThreadMessage,
} from "./pending-thread-messages";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
});

it("persists separate submissions and retains them across storage refreshes", () => {
  const queryClient = new QueryClient();
  const submit = (text: string) =>
    retainThreadMessage({
      queryClient,
      operation: "queue",
      request: {
        id: "thread-1",
        input: [{ type: "text", text, mentions: [] }],
      },
    });
  submit("first draft");
  submit("second draft");
  const before = getPendingThreadMessages();
  expect(before).toHaveLength(2);
  expect(before[0]?.request.clientSubmissionId).not.toBe(
    before[1]?.request.clientSubmissionId,
  );
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(getPendingThreadMessages()).toEqual(before);
  removePendingThreadMessage(before[0]!.row.id);
  expect(getPendingThreadMessages().map((entry) => entry.row.content)).toEqual([
    before[1]!.row.content,
  ]);
});

it("reports storage failure before a caller can clear its composer", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  expect(() =>
    retainThreadMessage({
      queryClient: new QueryClient(),
      operation: "queue",
      request: {
        id: "thread-1",
        input: [{ type: "text", text: "keep me", mentions: [] }],
      },
    }),
  ).toThrow("Full");
  expect(getPendingThreadMessages()).toHaveLength(0);
});
