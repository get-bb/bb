// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PendingThreadMessagesSync } from "./PendingThreadMessagesSync";
import {
  getPendingThreadMessages,
  retainThreadMessage,
} from "./pending-thread-messages";
import { sdk } from "./sdk";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { messageSubmissionKeys: true } }),
}));
vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => "connected",
}));
vi.mock("./ws", () => ({
  wsManager: { getConnectionState: () => "connected" },
}));
vi.mock("./sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sdk")>()),
  sdk: { threads: { queuedMessages: { create: vi.fn() } } },
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  vi.clearAllMocks();
});

it("retains an uncertain request and retries with the same submission key until confirmed", async () => {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  vi.mocked(sdk.threads.queuedMessages.create)
    .mockRejectedValueOnce(new TypeError("Response lost"))
    .mockImplementationOnce(async (request) => ({
      ...getPendingThreadMessages()[0]!.row,
      clientSubmissionId: request.clientSubmissionId,
    }));
  render(<PendingThreadMessagesSync />, { wrapper });
  act(() =>
    retainThreadMessage({
      queryClient,
      operation: "queue",
      request: {
        id: "thread-1",
        input: [{ type: "text", text: "saved locally", mentions: [] }],
      },
    }),
  );
  await waitFor(() =>
    expect(sdk.threads.queuedMessages.create).toHaveBeenCalledTimes(1),
  );
  expect(getPendingThreadMessages()).toHaveLength(1);
  await waitFor(() => expect(getPendingThreadMessages()).toHaveLength(0), {
    timeout: 3000,
  });
  const calls = vi.mocked(sdk.threads.queuedMessages.create).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1]![0].clientSubmissionId).toBe(calls[0]![0].clientSubmissionId);
  queryClient.clear();
});
