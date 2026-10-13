import { randomUUID } from "node:crypto";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it, vi } from "vitest";
import { createHostEntry } from "./host.js";
import type { ResolvedRuntime } from "./runtime-pin.js";
import type { RuntimeSession } from "./runtime.js";

const runtime: ResolvedRuntime = {
  binary: process.execPath,
  version: "1.0.0-test",
  source: "release",
};
const resolver = async () => runtime;

const open = (sessionId: string) => ({
  sessionId,
  expiresAt: Date.now() + 60_000,
  idleTimeoutMs: 30_000,
});
describe("host runtime preparation", () => {
  it("long-polls one shared install, then opens with it", async () => {
    let resolveInstall!: (runtime: ResolvedRuntime) => void;
    let detail = "";
    const resolver = vi.fn(
      (args: { onProgress: (detail: string) => void }) =>
        new Promise<ResolvedRuntime>((resolve) => {
          resolveInstall = resolve;
          args.onProgress("downloading");
          detail = "downloading";
        }),
    );
    const factory = vi.fn(async (): Promise<RuntimeSession> => ({
      close: async () => {},
      preview: null,
      run: async () => {
        throw new Error("unused");
      },
    }));
    const harness = experimental_createHostEntryHarness(
      createHostEntry(factory, resolver, {
        preparePollMs: 50,
        abandonedInstallGraceMs: 50,
      }),
    );
    const first = await harness.experimental_call("prepare", {});
    expect(first).toEqual({ status: "installing", detail });
    const second = harness.experimental_call("prepare", {});
    const opening = harness.experimental_call("open", open(randomUUID()));
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBeGreaterThan(
      0,
    );
    resolveInstall(runtime);
    expect(await second).toEqual({
      status: "ready",
      version: runtime.version,
      source: runtime.source,
    });
    await opening;
    expect(resolver).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ runtime }));
    await harness.experimental_dispose();
  });
  it("aborts an install nobody is waiting for and retries after failure", async () => {
    const signals: AbortSignal[] = [];
    const resolver = vi
      .fn()
      .mockImplementationOnce(
        (args: { signal: AbortSignal }) =>
          new Promise<ResolvedRuntime>((_resolve, reject) => {
            signals.push(args.signal);
            args.signal.addEventListener("abort", () =>
              reject(new Error("cancelled")),
            );
          }),
      )
      .mockRejectedValueOnce(new Error("npm is not available"))
      .mockResolvedValueOnce(runtime);
    const harness = experimental_createHostEntryHarness(
      createHostEntry(vi.fn(), resolver, {
        preparePollMs: 5_000,
        abandonedInstallGraceMs: 30,
      }),
    );
    const controller = new AbortController();
    const poll = harness.experimental_call(
      "prepare",
      {},
      {
        signal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();
    await expect(poll).rejects.toThrow();
    await vi.waitFor(() => expect(signals[0]!.aborted).toBe(true));
    await vi.waitFor(() =>
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0),
    );
    await expect(harness.experimental_call("prepare", {})).rejects.toThrow(
      "npm is not available",
    );
    expect(await harness.experimental_call("prepare", {})).toMatchObject({
      status: "ready",
    });
    expect(resolver).toHaveBeenCalledTimes(3);
    await harness.experimental_dispose();
  });
});
describe("host long-poll abandonment", () => {
  it("releases the poll waiter when prepare returns installing, so an unpolled install is aborted", async () => {
    const signals: AbortSignal[] = [];
    const resolver = vi.fn(
      (args: { signal: AbortSignal }) =>
        new Promise<ResolvedRuntime>((_resolve, reject) => {
          signals.push(args.signal);
          args.signal.addEventListener("abort", () =>
            reject(new Error("cancelled")),
          );
        }),
    );
    const harness = experimental_createHostEntryHarness(
      createHostEntry(vi.fn(), resolver, {
        preparePollMs: 20,
        abandonedInstallGraceMs: 40,
      }),
    );
    expect(await harness.experimental_call("prepare", {})).toMatchObject({
      status: "installing",
    });
    expect(signals[0]!.aborted).toBe(false);
    await vi.waitFor(() => expect(signals[0]!.aborted).toBe(true));
    await vi.waitFor(() =>
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0),
    );
    await harness.experimental_dispose();
  });
});
describe("host session lifetime", () => {
  it("close disposes only the selected runtime and reload disposes the rest", async () => {
    const firstClose = vi.fn(async () => {});
    const secondClose = vi.fn(async () => {});
    const factory = vi
      .fn()
      .mockResolvedValueOnce({ close: firstClose })
      .mockResolvedValueOnce({ close: secondClose });
    const harness = experimental_createHostEntryHarness(
      createHostEntry(factory, resolver),
    );
    const a = randomUUID(),
      b = randomUUID();
    await harness.experimental_call("open", open(a));
    await harness.experimental_call("open", open(b));
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(2);
    await harness.experimental_call("close", { sessionId: a });
    expect(firstClose).toHaveBeenCalledOnce();
    expect(secondClose).not.toHaveBeenCalled();
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
    await harness.experimental_dispose();
    expect(secondClose).toHaveBeenCalledOnce();
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  });
  it("cancellation closes a running session and rejects further use", async () => {
    const close = vi.fn(async () => {});
    const harness = experimental_createHostEntryHarness(
      createHostEntry(
        async () => ({
          close,
          preview: null,
          run: async (_script, _timeout, signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new Error("cancelled")),
                { once: true },
              );
            }),
        }),
        resolver,
      ),
    );
    const id = randomUUID();
    await harness.experimental_call("open", open(id));
    const controller = new AbortController();
    const run = harness.experimental_call(
      "run",
      { sessionId: id, script: "1", timeoutMs: 1000 },
      { signal: controller.signal },
    );
    const rejected = expect(run).rejects.toThrow();
    await vi.waitFor(() =>
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await rejected;
    expect(close).toHaveBeenCalledOnce();
    await expect(
      harness.experimental_call("run", {
        sessionId: id,
        script: "1",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("stopped");
    await harness.experimental_dispose();
  });
  it("failed startup releases worker retention", async () => {
    const harness = experimental_createHostEntryHarness(
      createHostEntry(async () => {
        throw new Error("launch failed");
      }, resolver),
    );
    await expect(
      harness.experimental_call("open", open(randomUUID())),
    ).rejects.toThrow("launch failed");
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    await harness.experimental_dispose();
  });
});
describe("host live preview", () => {
  const frame = {
    sequence: 3,
    mimeType: "image/jpeg" as const,
    data: "abc",
    width: 1280,
    height: 720,
    url: "https://example.test/",
    title: "Example",
  };
  it("long-polls the session preview without counting as session activity", async () => {
    const next = vi.fn(async () => frame);
    const close = vi.fn(async () => {});
    const harness = experimental_createHostEntryHarness(
      createHostEntry(
        async () => ({
          close,
          preview: { next, close() {} },
          run: async () => ({ text: "", images: [], exitCode: 0 }),
        }),
        resolver,
      ),
    );
    const id = randomUUID();
    await harness.experimental_call("open", {
      sessionId: id,
      expiresAt: Date.now() + 60_000,
      idleTimeoutMs: 1_200,
    });
    const started = Date.now();
    while (Date.now() - started < 1_000) {
      expect(
        await harness.experimental_call("preview", {
          sessionId: id,
          afterSequence: 2,
          waitMs: 5_000,
          size: "full",
        }),
      ).toEqual({ frame });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(next).toHaveBeenCalledWith(
      2,
      5_000,
      expect.any(AbortSignal),
      "full",
    );
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce(), {
      timeout: 3_000,
    });
    await expect(
      harness.experimental_call("preview", {
        sessionId: id,
        afterSequence: 0,
        waitMs: 0,
        size: "thumbnail",
      }),
    ).rejects.toThrow("stopped");
    await harness.experimental_dispose();
  });
  it("refuses sessions attached to a desktop browser and cancels waits on close", async () => {
    const waiting = vi.fn(
      (_after: number, _wait: number, signal: AbortSignal) =>
        new Promise<null>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("stopped")), {
            once: true,
          });
        }),
    );
    const factory = vi
      .fn()
      .mockResolvedValueOnce({ close: async () => {}, preview: null })
      .mockResolvedValueOnce({
        close: async () => {},
        preview: { next: waiting, close() {} },
      });
    const harness = experimental_createHostEntryHarness(
      createHostEntry(factory, resolver),
    );
    const desktop = randomUUID(),
      local = randomUUID();
    await harness.experimental_call("open", {
      ...open(desktop),
      connectionUrl: "ws://127.0.0.1:9/devtools/browser/x",
    });
    await harness.experimental_call("open", open(local));
    await expect(
      harness.experimental_call("preview", {
        sessionId: desktop,
        afterSequence: 0,
        waitMs: 0,
        size: "thumbnail",
      }),
    ).rejects.toThrow("local headless");
    const pending = harness.experimental_call("preview", {
      sessionId: local,
      afterSequence: 0,
      waitMs: 5_000,
      size: "thumbnail",
    });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledOnce());
    await harness.experimental_call("close", { sessionId: local });
    await rejected;
    await harness.experimental_dispose();
  });
});
