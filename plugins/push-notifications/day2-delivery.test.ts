// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createDay2Delivery } from "./day2-delivery.js";

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const host = createFakePluginHost({ pluginId: "push-notifications" });
  const deliver = vi.fn(async () => {});
  const queue = createDay2Delivery({ bb: host.bb, now: Date.now, deliver });
  const input = {
    marker: {
      pending: true as const,
      automationId: "automation-1",
      acceptedAt: 9_000,
      deliverAt: 20_000,
    },
    threadId: "thread-1",
    eventAt: 10_000,
    kind: "day2_result" as const,
    body: "The result is ready",
    consumeMarker: vi.fn(async () => {}),
  };
  return { host, queue, input, deliver };
}

afterEach(() => vi.useRealTimers());

describe("held day-two delivery", () => {
  it("persists before consuming the marker and delivers once at the due time", async () => {
    const { host, queue, input, deliver } = setup();
    try {
      await queue.start();
      input.consumeMarker.mockImplementation(async () => {
        expect(await host.bb.storage.kv.get("day2-delivery")).toMatchObject({
          held: [{ automationId: "automation-1", threadId: "thread-1" }],
        });
      });
      await queue.hold(input);
      expect(deliver).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(deliver).toHaveBeenCalledTimes(1);
      await queue.onAppOpened();
      expect(deliver).toHaveBeenCalledTimes(1);
    } finally {
      await queue.stop();
      await host.harness.lifecycle.dispose();
    }
  });

  it("remembers an opening before completion but ignores an opening before acceptance", async () => {
    const { host, queue, input, deliver } = setup();
    try {
      await queue.start();
      vi.setSystemTime(8_000);
      await queue.onAppOpened();
      vi.setSystemTime(10_000);
      await queue.hold(input);
      expect(deliver).not.toHaveBeenCalled();
      await queue.onAppOpened();
      expect(deliver).toHaveBeenCalledTimes(1);
      const later = {
        ...input,
        marker: { ...input.marker, automationId: "automation-2" },
      };
      await queue.hold(later);
      expect(deliver).toHaveBeenCalledTimes(2);
    } finally {
      await queue.stop();
      await host.harness.lifecycle.dispose();
    }
  });

  it("recovers held results in a new sender after restart", async () => {
    const { host, queue, input, deliver } = setup();
    const resumed = createDay2Delivery({ bb: host.bb, now: Date.now, deliver });
    try {
      await queue.start();
      await queue.hold(input);
      await queue.stop();
      await vi.advanceTimersByTimeAsync(11_000);
      expect(deliver).not.toHaveBeenCalled();
      await resumed.start();
      expect(deliver).toHaveBeenCalledTimes(1);
      await resumed.hold(input);
      expect(deliver).toHaveBeenCalledTimes(1);
    } finally {
      await resumed.stop();
      await queue.stop();
      await host.harness.lifecycle.dispose();
    }
  });

  it("persists cancellation before completion and cancels already held results", async () => {
    const { host, queue, input, deliver } = setup();
    const resumed = createDay2Delivery({ bb: host.bb, now: Date.now, deliver });
    try {
      await queue.start();
      await queue.cancel(input.marker.automationId);
      await queue.stop();
      await resumed.start();
      await resumed.hold(input);
      const later = {
        ...input,
        marker: { ...input.marker, automationId: "automation-2" },
      };
      await resumed.hold(later);
      await resumed.cancel(later.marker.automationId);
      await resumed.onAppOpened();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(input.consumeMarker).toHaveBeenCalledTimes(2);
      expect(deliver).not.toHaveBeenCalled();
    } finally {
      await resumed.stop();
      await queue.stop();
      await host.harness.lifecycle.dispose();
    }
  });

  it("serializes simultaneous openings and duplicate completion markers", async () => {
    const { host, queue, input, deliver } = setup();
    try {
      await queue.start();
      await Promise.all([
        queue.hold(input),
        queue.onAppOpened(),
        queue.hold(input),
        queue.onAppOpened(),
      ]);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(deliver).toHaveBeenCalledTimes(1);
    } finally {
      await queue.stop();
      await host.harness.lifecycle.dispose();
    }
  });
});
