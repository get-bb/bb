import { describe, expect, it, vi } from "vitest";
import { createCloudDevProxy } from "../../../scripts/lib/cloud-dev-proxy.mjs";

describe("local Cloud proxy errors", () => {
  it.each(["EPIPE", "ECONNRESET"])(
    "does not crash when a WebSocket client closes with %s",
    (code) => {
      const reportError = vi.fn();
      const proxy = createCloudDevProxy({ reportError });
      const connection = { destroy: vi.fn() };
      const error = Object.assign(new Error(`write ${code}`), { code });

      expect(() => proxy.emit("error", error, {}, connection)).not.toThrow();
      expect(connection.destroy).toHaveBeenCalledOnce();
      expect(reportError).not.toHaveBeenCalled();
    },
  );

  it("reports unexpected proxy errors without crashing", () => {
    const reportError = vi.fn();
    const proxy = createCloudDevProxy({ reportError });
    const connection = { destroy: vi.fn() };

    expect(() =>
      proxy.emit("error", new Error("unexpected failure"), {}, connection),
    ).not.toThrow();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      "bb Cloud dev proxy: unexpected failure",
    );
  });
});
