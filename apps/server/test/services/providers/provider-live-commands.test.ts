import type { ThreadProviderCommand } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  PROVIDER_LIVE_COMMANDS_FRESH_MS,
  createProviderLiveCommandsCache,
} from "../../../src/services/providers/provider-live-commands.js";

function command(name: string): ThreadProviderCommand {
  return { name, description: "" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness() {
  let clock = 1_000;
  const cache = createProviderLiveCommandsCache({ now: () => clock });
  const onChanged = vi.fn();
  const onRefreshError = vi.fn();
  const load = vi.fn<() => Promise<ThreadProviderCommand[]>>();
  const read = () =>
    cache.read({ key: "host-a", load, onChanged, onRefreshError });
  return {
    advance: (ms: number) => {
      clock += ms;
    },
    load,
    onChanged,
    onRefreshError,
    read,
  };
}

describe("provider live commands cache", () => {
  it("keeps the previous list when a refresh fails and retries on the next read", async () => {
    const h = harness();
    h.load.mockResolvedValueOnce([command("loop")]);
    await expect(h.read()).resolves.toEqual([command("loop")]);

    h.advance(PROVIDER_LIVE_COMMANDS_FRESH_MS);
    const failure = new Error("bridge crashed");
    h.load.mockRejectedValueOnce(failure);
    await expect(h.read()).resolves.toEqual([command("loop")]);
    await vi.waitFor(() =>
      expect(h.onRefreshError).toHaveBeenCalledWith(failure),
    );

    h.load.mockResolvedValueOnce([command("loop"), command("review")]);
    await expect(h.read()).resolves.toEqual([command("loop")]);
    await vi.waitFor(() => expect(h.onChanged).toHaveBeenCalledTimes(1));
    await expect(h.read()).resolves.toEqual([
      command("loop"),
      command("review"),
    ]);
    expect(h.load).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failed first load", async () => {
    const h = harness();
    h.load.mockRejectedValueOnce(new Error("host offline"));
    await expect(h.read()).rejects.toThrow("host offline");

    h.load.mockResolvedValueOnce([command("loop")]);
    await expect(h.read()).resolves.toEqual([command("loop")]);
  });

  it("shares one load between concurrent first reads", async () => {
    const h = harness();
    const pending = deferred<ThreadProviderCommand[]>();
    h.load.mockReturnValueOnce(pending.promise);
    const first = h.read();
    const second = h.read();
    pending.resolve([command("loop")]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      [command("loop")],
      [command("loop")],
    ]);
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it("starts one refresh per stale window and stays quiet when nothing changed", async () => {
    const h = harness();
    h.load.mockResolvedValue([command("loop")]);
    await h.read();

    h.advance(PROVIDER_LIVE_COMMANDS_FRESH_MS);
    await Promise.all([h.read(), h.read(), h.read()]);
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    await h.read();
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.onChanged).not.toHaveBeenCalled();
  });
});
