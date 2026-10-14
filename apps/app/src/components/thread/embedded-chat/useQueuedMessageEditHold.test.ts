import { beforeEach, describe, expect, it, vi } from "vitest";
import { BbHttpError } from "@bb/sdk/browser";
import { createDeferredPromise } from "@bb/test-helpers";
import { startQueuedMessageEditHold } from "./useQueuedMessageEditHold";

const mocks = vi.hoisted(() => ({
  holdForEdit: vi.fn(),
  releaseEditHold: vi.fn(),
  showMutationErrorToast: vi.fn(),
}));

vi.mock("@/lib/sdk", async () => ({
  BbHttpError: (await import("@bb/sdk/browser")).BbHttpError,
  sdk: {
    threads: {
      queuedMessages: {
        experimental_holdForEdit: mocks.holdForEdit,
        experimental_releaseEditHold: mocks.releaseEditHold,
      },
    },
  },
}));

vi.mock("@/lib/mutation-errors", () => ({
  showMutationErrorToast: mocks.showMutationErrorToast,
}));

const target = { queuedMessageId: "qmsg_1", threadId: "thr_1" };

describe("startQueuedMessageEditHold", () => {
  beforeEach(() => {
    mocks.holdForEdit.mockReset();
    mocks.releaseEditHold.mockReset().mockResolvedValue({ ok: true });
    mocks.showMutationErrorToast.mockReset();
  });

  it("releases the hold only after an in-flight hold request settles", async () => {
    const hold = createDeferredPromise<{ leaseMs: number }>();
    mocks.holdForEdit.mockReturnValue(hold.promise);
    const onRejected = vi.fn();
    const stop = startQueuedMessageEditHold({
      target,
      requestChain: { current: Promise.resolve() },
      onRejected,
    });
    await vi.waitFor(() => {
      expect(mocks.holdForEdit).toHaveBeenCalledWith(target);
    });

    stop();
    await Promise.resolve();
    expect(mocks.releaseEditHold).not.toHaveBeenCalled();

    hold.resolve({ leaseMs: 120_000 });
    await vi.waitFor(() => {
      expect(mocks.releaseEditHold).toHaveBeenCalledWith(target);
    });
    expect(mocks.holdForEdit).toHaveBeenCalledTimes(1);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("closes the editor when a dispatch already claimed the message", async () => {
    mocks.holdForEdit.mockRejectedValue(
      new BbHttpError({
        status: 409,
        code: "invalid_request",
        message: "Queued message is already being sent",
        body: {
          code: "invalid_request",
          message: "Queued message is already being sent",
        },
      }),
    );
    const onRejected = vi.fn();
    const stop = startQueuedMessageEditHold({
      target,
      requestChain: { current: Promise.resolve() },
      onRejected,
    });

    await vi.waitFor(() => {
      expect(onRejected).toHaveBeenCalledTimes(1);
    });
    expect(mocks.showMutationErrorToast).toHaveBeenCalledTimes(1);
    stop();
  });
});
