import type { BbSdkAreas } from "@bb/sdk";
import { describe, expect, it, vi } from "vitest";
import { bindSdkToPlugin, getPluginBoundSdk } from "./plugin-bound-sdk";

function makeSdk() {
  const threads = {
    spawn: vi.fn(async (args: unknown) => args),
    fork: vi.fn(async (args: unknown) => args),
    getPluginMetadata: vi.fn(async (args: unknown) => args),
    updatePluginMetadata: vi.fn(async (args: unknown) => args),
    pin: vi.fn(async (args: unknown) => args),
  };
  const threadSections = { create: vi.fn(async (args: unknown) => args) };
  return {
    sdk: { threads, threadSections } as unknown as BbSdkAreas,
    threads,
    threadSections,
  };
}

describe("bindSdkToPlugin", () => {
  it("stamps the plugin as the origin of spawned and forked threads", async () => {
    const { sdk, threads } = makeSdk();
    const bound = bindSdkToPlugin(sdk, "thread-list");
    await bound.threads.spawn({ projectId: "proj_1", prompt: "hi" } as never);
    expect(threads.spawn).toHaveBeenCalledWith({
      projectId: "proj_1",
      prompt: "hi",
      origin: "plugin",
      originPluginId: "thread-list",
    });
    await bound.threads.fork({ sourceThreadId: "thr_1" } as never);
    expect(threads.fork).toHaveBeenCalledWith({
      sourceThreadId: "thr_1",
      origin: "plugin",
      originPluginId: "thread-list",
    });
  });

  it("keeps an explicit non-plugin origin and an explicit plugin id", async () => {
    const { sdk, threads } = makeSdk();
    const bound = bindSdkToPlugin(sdk, "thread-list");
    await bound.threads.spawn({ prompt: "hi", origin: "user" } as never);
    expect(threads.spawn).toHaveBeenLastCalledWith({
      prompt: "hi",
      origin: "user",
    });
    await bound.threads.spawn({
      prompt: "hi",
      origin: "plugin",
      originPluginId: "other",
    } as never);
    expect(threads.spawn).toHaveBeenLastCalledWith({
      prompt: "hi",
      origin: "plugin",
      originPluginId: "other",
    });
    await bound.threads.spawn({
      prompt: "hi",
      origin: "user",
      pluginMetadata: { note: 1 },
    } as never);
    expect(threads.spawn).toHaveBeenLastCalledWith({
      prompt: "hi",
      origin: "plugin",
      originPluginId: "thread-list",
      pluginMetadata: { note: 1 },
    });
  });

  it("defaults the plugin id on metadata calls without hiding an explicit one", async () => {
    const { sdk, threads } = makeSdk();
    const bound = bindSdkToPlugin(sdk, "thread-list");
    await bound.threads.getPluginMetadata({ threadId: "thr_1" });
    expect(threads.getPluginMetadata).toHaveBeenCalledWith({
      threadId: "thr_1",
      pluginId: "thread-list",
    });
    await bound.threads.updatePluginMetadata({
      threadId: "thr_1",
      pluginId: "other",
      set: { a: 1 },
    });
    expect(threads.updatePluginMetadata).toHaveBeenCalledWith({
      threadId: "thr_1",
      pluginId: "other",
      set: { a: 1 },
    });
  });

  it("passes every other area and method through untouched", async () => {
    const { sdk, threads, threadSections } = makeSdk();
    const bound = bindSdkToPlugin(sdk, "thread-list");
    await bound.threads.pin({ threadId: "thr_1" });
    await bound.threadSections.create({ name: "Later" });
    expect(threads.pin).toHaveBeenCalledWith({ threadId: "thr_1" });
    expect(threadSections.create).toHaveBeenCalledWith({ name: "Later" });
  });
});

describe("getPluginBoundSdk", () => {
  it("returns one stable client per plugin per underlying sdk", () => {
    const { sdk } = makeSdk();
    const other = makeSdk().sdk;
    expect(getPluginBoundSdk(sdk, "a")).toBe(getPluginBoundSdk(sdk, "a"));
    expect(getPluginBoundSdk(sdk, "a")).not.toBe(getPluginBoundSdk(sdk, "b"));
    expect(getPluginBoundSdk(sdk, "a")).not.toBe(getPluginBoundSdk(other, "a"));
  });
});
