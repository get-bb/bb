import { afterEach, expect, it, vi } from "vitest";
import { BbHttpError } from "../src/response.js";
import { createPluginReadWatcher } from "../src/plugin-read-watcher.js";

afterEach(() => vi.useRealTimers());

it.each([
  [400, null],
  [401, null],
  [403, "forbidden"],
  [404, "not_found"],
  [409, "conflict"],
  [422, "invalid"],
] as const)("stops on permanent HTTP %i", async (status, code) => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValue(
    new BbHttpError({
      status,
      message: "rejected",
      code,
      body: null,
    }),
  );
  const onStop = vi.fn();
  const onError = vi.fn();
  const watch = createPluginReadWatcher({
    signal: new AbortController().signal,
    read,
    onChange: vi.fn(),
    onStop,
    onError,
  });
  watch.refresh();
  await vi.advanceTimersByTimeAsync(0);
  watch.refresh();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0]?.[0]).toMatchObject({
    code,
    message: `HTTP ${status}: rejected`,
  });
  await watch.done;
});

it.each([408, 429, 503, 404])(
  "recovers from unavailable HTTP %i",
  async (status) => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockRejectedValueOnce(
        new BbHttpError({
          status,
          message: "unavailable",
          code: null,
          body: null,
        }),
      )
      .mockResolvedValue(7);
    const onChange = vi.fn();
    const watch = createPluginReadWatcher({
      signal: new AbortController().signal,
      read,
      retryNotFound: true,
      onChange,
      onStop: vi.fn(),
    });
    watch.refresh();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledWith(7);
    watch();
    await watch.done;
  },
);

it("reports lost availability during preparation, discards queued stale values, and drains on stop", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi
    .fn()
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(2)
    .mockRejectedValueOnce(new Error("unavailable"));
  const prepare = vi.fn(() => blocked);
  const onChange = vi.fn();
  const onError = vi.fn();
  const watch = createPluginReadWatcher({
    signal: new AbortController().signal,
    read,
    prepare,
    onChange,
    onError,
    onStop: vi.fn(),
  });
  watch.refresh();
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  watch.refresh();
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  watch.refresh();
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  watch();
  let drained = false;
  void watch.done.then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  release();
  await watch.done;
  expect(prepare).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
});

it("retries a fresh read when preparation fails and re-reads when preparation requests refresh", async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(2)
    .mockResolvedValue(3);
  const onChange = vi.fn();
  const watch = createPluginReadWatcher({
    signal: new AbortController().signal,
    read,
    onChange,
    onStop: vi.fn(),
    prepare: async (value) => {
      if (value === 1) throw new Error("disk busy");
      if (value === 2) watch.refresh();
    },
  });
  watch.refresh();
  await vi.advanceTimersByTimeAsync(1000);
  expect(onChange.mock.calls).toEqual([[3]]);
  watch();
  await watch.done;
});

it("preserves preparation backoff across invalidations while still reading current availability", async () => {
  vi.useFakeTimers();
  const prepare = vi.fn().mockRejectedValue(new Error("offline"));
  const read = vi.fn().mockResolvedValue(1);
  const watch = createPluginReadWatcher({
    signal: new AbortController().signal,
    read,
    prepare,
    onChange: vi.fn(),
    onStop: vi.fn(),
  });
  watch.refresh();
  await vi.advanceTimersByTimeAsync(0);
  watch.refresh();
  await vi.advanceTimersByTimeAsync(999);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(prepare).toHaveBeenCalledTimes(2);
  watch();
  await watch.done;
});

it.each(["own", "unrelated"])(
  "matches in-flight response tags against %s invalidations",
  async (tag) => {
    let release!: (value: number) => void;
    const first = new Promise<number>((resolve) => {
      release = resolve;
    });
    const read = vi.fn().mockReturnValueOnce(first).mockResolvedValue(2);
    const onChange = vi.fn();
    const watch = createPluginReadWatcher({
      signal: new AbortController().signal,
      read,
      tagsOf: () => ["own"],
      onChange,
      onStop: vi.fn(),
    });
    watch.refresh();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    watch.invalidate([tag]);
    release(1);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(onChange.mock.calls).toEqual([[tag === "own" ? 2 : 1]]);
    watch();
    await watch.done;
  },
);

it("prepares an unchanged snapshot again only after an error resets synchronization", async () => {
  const read = vi.fn().mockResolvedValue(1);
  const prepare = vi.fn();
  const onChange = vi.fn();
  const onError = vi.fn();
  const watch = createPluginReadWatcher({
    signal: new AbortController().signal,
    read,
    prepare,
    prepareKey: String,
    onChange,
    onError,
    onStop: vi.fn(),
  });
  watch.refresh();
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  watch.refresh();
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
  expect(prepare).toHaveBeenCalledOnce();
  read.mockRejectedValueOnce(new Error("unavailable"));
  watch.refresh();
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  watch.refresh();
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2), {
    timeout: 3000,
  });
  watch();
  await watch.done;
});
