import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeepAwakeHostEntry } from "./host.js";

function createChild() {
  const listeners = new Map<"error" | "exit", () => void>();
  return {
    kill: vi.fn(() => true),
    once(event: "error" | "exit", listener: () => void) {
      listeners.set(event, listener);
      return this;
    },
    emit(event: "error" | "exit") {
      listeners.get(event)?.();
    },
  };
}

describe("builtin Keep Awake host entry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("owns and restarts one caffeinate child for its generation", async () => {
    vi.useFakeTimers();
    const firstChild = createChild();
    const secondChild = createChild();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const harness = experimental_createHostEntryHarness(
      createKeepAwakeHostEntry({ platform: "darwin", pid: 1234, spawn }),
    );

    await expect(
      harness.experimental_call("setEnabled", { enabled: true }),
    ).resolves.toEqual({ enabled: true, supported: true });
    await harness.experimental_call("setEnabled", { enabled: true });
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      "/usr/bin/caffeinate",
      ["-i", "-w", "1234"],
      { stdio: "ignore" },
    );
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);

    firstChild.emit("exit");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    await expect(
      harness.experimental_call("setEnabled", { enabled: true }),
    ).resolves.toEqual({ enabled: true, supported: true });
    await harness.experimental_dispose();
  });

  it("retries when spawning caffeinate fails synchronously", async () => {
    vi.useFakeTimers();
    const child = createChild();
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("spawn failed");
      })
      .mockReturnValueOnce(child);
    const harness = experimental_createHostEntryHarness(
      createKeepAwakeHostEntry({ platform: "darwin", pid: 1234, spawn }),
    );

    await expect(
      harness.experimental_call("setEnabled", { enabled: true }),
    ).resolves.toEqual({ enabled: false, supported: true });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    await expect(
      harness.experimental_call("setEnabled", { enabled: true }),
    ).resolves.toEqual({ enabled: true, supported: true });

    await harness.experimental_dispose();
  });

  it("never spawns on unsupported hosts", async () => {
    const spawn = vi.fn(() => createChild());
    const harness = experimental_createHostEntryHarness(
      createKeepAwakeHostEntry({ platform: "linux", pid: 1234, spawn }),
    );

    await expect(
      harness.experimental_call("setEnabled", { enabled: true }),
    ).resolves.toEqual({ enabled: false, supported: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("stops its child on disable and generation disposal", async () => {
    const firstChild = createChild();
    const secondChild = createChild();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const harness = experimental_createHostEntryHarness(
      createKeepAwakeHostEntry({ platform: "darwin", pid: 1234, spawn }),
    );

    await harness.experimental_call("setEnabled", { enabled: true });
    await harness.experimental_call("setEnabled", { enabled: false });
    expect(firstChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);

    await harness.experimental_call("setEnabled", { enabled: true });
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
    await harness.experimental_dispose();
    expect(secondChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  });
});
