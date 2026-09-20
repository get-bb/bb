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
  sdk: { threads: { send: vi.fn(), queuedMessages: { create: vi.fn() } } },
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  vi.clearAllMocks();
});

it.each(["queue", "send", "steer"] as const)(
  "retains an uncertain %s and retries with the same submission key until confirmed",
  async (operation) => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    vi.mocked(sdk.threads.queuedMessages.create)
      .mockRejectedValueOnce(new TypeError("Response lost"))
      .mockImplementationOnce(async (request) => ({
        ...getPendingThreadMessages()[0]!.row,
        clientSubmissionId: request.clientSubmissionId,
      }));
    vi.mocked(sdk.threads.send).mockImplementation(async (request) => ({
      ok: true,
      delivery: "queued",
      queuedMessage: await sdk.threads.queuedMessages.create(request),
    }));
    render(<PendingThreadMessagesSync />, { wrapper });
    act(() =>
      retainThreadMessage({
        queryClient,
        operation,
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
    if (operation !== "queue") {
      expect(sdk.threads.send).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: operation === "steer" ? "steer-if-active" : "queue-if-active",
        }),
      );
    }
    queryClient.clear();
  },
);
