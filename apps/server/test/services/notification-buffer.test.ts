import { describe, expect, it, vi } from "vitest";
import { NotificationBuffer } from "../../src/services/lib/notification-buffer.js";

describe("NotificationBuffer", () => {
  it("best-effort flush attempts every notification and truthfully reports failures", () => {
    const buffer = new NotificationBuffer();
    buffer.notifyThread("thread-1", ["archived-changed"]);
    buffer.notifyThread("thread-2", ["status-changed"]);
    const notifyThread = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("first socket failed");
      })
      .mockImplementationOnce(() => undefined);
    const onError = vi.fn();

    expect(
      buffer.flushIntoBestEffort(
        {
          notifyEnvironment: vi.fn(),
          notifyHost: vi.fn(),
          notifyProject: vi.fn(),
          notifySystem: vi.fn(),
          notifyThread,
        },
        onError,
      ),
    ).toBe(false);
    expect(notifyThread).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "first socket failed" }),
    );
  });
});
