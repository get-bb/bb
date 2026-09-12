import { QueryClient, hashKey } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSocketFactory } from "../realtime/fake-socket";
import { createMobileRealtime } from "../realtime/mobile-realtime";
import { installRealtimeInvalidation } from "./realtime-invalidation";
import { systemConfigQueryKey } from "./query-keys";

function setup() {
  const factory = createFakeSocketFactory();
  const realtime = createMobileRealtime({
    url: "ws://x/ws",
    socketFactory: factory,
    onInvalidMessage: () => {},
  });
  const queryClient = new QueryClient();
  const invalidated: string[] = [];
  const invalidateSpy = vi
    .spyOn(queryClient, "invalidateQueries")
    .mockImplementation(async (filters) => {
      invalidated.push(filters?.queryKey ? hashKey(filters.queryKey) : "*");
    });
  const handle = installRealtimeInvalidation(queryClient, realtime);
  realtime.connect();
  factory.latest().open();
  return { factory, realtime, queryClient, invalidated, invalidateSpy, handle };
}

describe("installRealtimeInvalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of host and system frames into one system config invalidation", () => {
    const { factory, invalidated } = setup();
    const socket = factory.latest();
    for (let i = 0; i < 20; i++) {
      socket.receive(
        JSON.stringify(
          i % 2 === 0
            ? {
                type: "changed",
                entity: "host",
                id: "h1",
                changes: ["host-connected"],
              }
            : {
                type: "changed",
                entity: "system",
                changes: ["config-changed"],
              },
        ),
      );
      vi.advanceTimersByTime(5);
    }
    expect(invalidated).toEqual([]);
    vi.advanceTimersByTime(49);
    expect(invalidated).toEqual([hashKey(systemConfigQueryKey())]);
    vi.advanceTimersByTime(500);
    expect(invalidated).toHaveLength(1);
  });

  it("does not invalidate for thread, project and environment frames", () => {
    const { factory, invalidated } = setup();
    const socket = factory.latest();
    socket.receive(
      JSON.stringify({
        type: "changed",
        entity: "thread",
        id: "t1",
        changes: ["events-appended", "title-changed"],
      }),
    );
    socket.receive(
      JSON.stringify({
        type: "changed",
        entity: "project",
        id: "p1",
        changes: ["project-sources-changed"],
      }),
    );
    socket.receive(
      JSON.stringify({
        type: "changed",
        entity: "environment",
        id: "env_1",
        changes: ["metadata-changed"],
      }),
    );
    vi.advanceTimersByTime(500);
    expect(invalidated).toEqual([]);
  });

  it("catches up from the reconnect watermark: only data older than the disconnect is invalidated, without cancelling in-flight fetches", () => {
    vi.setSystemTime(1_000_000);
    const { factory, queryClient, invalidateSpy } = setup();
    invalidateSpy.mockRestore();
    queryClient.setQueryData(["stale"], { id: "stale" });
    const staleQuery = queryClient.getQueryCache().find({
      queryKey: ["stale"],
    });
    vi.advanceTimersByTime(10_000);
    factory.latest().drop();
    const disconnectedAt = Date.now();
    vi.advanceTimersByTime(500);
    queryClient.setQueryData(["fresh"], { id: "fresh" });
    const freshQuery = queryClient.getQueryCache().find({
      queryKey: ["fresh"],
    });
    const spy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(async () => {});
    vi.advanceTimersByTime(500);
    factory.latest().open();

    expect(spy).toHaveBeenCalledTimes(1);
    const [filters, options] = spy.mock.calls[0] ?? [];
    expect(options).toEqual({ cancelRefetch: false });
    expect(filters?.queryKey).toBeUndefined();
    const predicate = filters?.predicate;
    if (!predicate || !staleQuery || !freshQuery) throw new Error("setup");
    expect(staleQuery.state.dataUpdatedAt).toBeLessThan(disconnectedAt);
    expect(freshQuery.state.dataUpdatedAt).toBeGreaterThan(disconnectedAt);
    expect(predicate(staleQuery)).toBe(true);
    expect(predicate(freshQuery)).toBe(false);
  });

  it("does not invalidate on the initial connect", () => {
    const { invalidated } = setup();
    vi.advanceTimersByTime(500);
    expect(invalidated).toEqual([]);
  });

  it("keeps a pending system config invalidation across a resume reconnect and adds the watermark catch-up", () => {
    const { factory, realtime, invalidated } = setup();
    factory.latest().receive(
      JSON.stringify({
        type: "changed",
        entity: "system",
        changes: ["config-changed"],
      }),
    );
    realtime.suspend();
    realtime.resume();
    factory.latest().open();
    vi.advanceTimersByTime(500);
    expect(invalidated).toEqual(
      expect.arrayContaining(["*", hashKey(systemConfigQueryKey())]),
    );
  });

  it("stops invalidating after dispose", () => {
    const { factory, invalidated, handle } = setup();
    handle.dispose();
    factory.latest().receive(
      JSON.stringify({
        type: "changed",
        entity: "system",
        changes: ["config-changed"],
      }),
    );
    vi.advanceTimersByTime(500);
    expect(invalidated).toEqual([]);
  });
});
