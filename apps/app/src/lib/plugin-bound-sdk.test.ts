import type { BbSdkAreas } from "@bb/sdk";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  makeEnvironment,
  makeThreadWithRuntime,
} from "@bb/test-helpers/domain-fixtures";
import {
  environmentQueryKey,
  threadQueryKey,
} from "@/hooks/queries/query-keys";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { bindSdkToPlugin, getPluginBoundSdk } from "./plugin-bound-sdk";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function makeSdk() {
  const threads = {
    spawn: vi.fn(async (args: unknown) => args),
    fork: vi.fn(async (args: unknown) => args),
    getPluginMetadata: vi.fn(async (args: unknown) => args),
    updatePluginMetadata: vi.fn(async (args: unknown) => args),
    update: vi.fn(async ({ threadId }: { threadId: string }) =>
      makeThreadResponse({ id: threadId }),
    ),
    pin: vi.fn(async (args: unknown) => args),
  };
  const environments = {
    update: vi.fn(async (args: { name?: string | null }) =>
      makeEnvironment({ id: "env_1", name: args.name ?? null }),
    ),
  };
  const threadSections = { create: vi.fn(async (args: unknown) => args) };
  return {
    sdk: { environments, threads, threadSections } as unknown as BbSdkAreas,
    environments,
    queryClient: new QueryClient(),
    threads,
    threadSections,
  };
}

describe("bindSdkToPlugin", () => {
  it("stamps the plugin as the origin of spawned and forked threads", async () => {
    const { sdk, queryClient, threads } = makeSdk();
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
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
    const { sdk, queryClient, threads } = makeSdk();
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
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
    const { sdk, queryClient, threads } = makeSdk();
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
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
    const { sdk, queryClient, threads, threadSections } = makeSdk();
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
    await bound.threads.pin({ threadId: "thr_1" });
    await bound.threadSections.create({ name: "Later" });
    expect(threads.pin).toHaveBeenCalledWith({ threadId: "thr_1" });
    expect(threadSections.create).toHaveBeenCalledWith({ name: "Later" });
  });

  it("batches synchronous plugin thread metadata updates into one optimistic transaction", async () => {
    const { sdk, queryClient, threads } = makeSdk();
    const pending = new Map<
      string,
      ReturnType<typeof deferred<ReturnType<typeof makeThreadResponse>>>
    >();
    threads.update.mockImplementation(({ threadId }: { threadId: string }) => {
      const request = deferred<ReturnType<typeof makeThreadResponse>>();
      pending.set(threadId, request);
      return request.promise;
    });
    for (const id of ["thr_1", "thr_2"]) {
      queryClient.setQueryData(
        threadQueryKey(id),
        makeThreadWithRuntime({ id, parentThreadId: null }),
      );
    }
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);

    const updates = ["thr_1", "thr_2"].map((threadId) =>
      bound.threads.update({ threadId, parentThreadId: "thr_parent" }),
    );

    await vi.waitFor(() => {
      expect(
        ["thr_1", "thr_2"].map(
          (id) =>
            queryClient.getQueryData<ReturnType<typeof makeThreadWithRuntime>>(
              threadQueryKey(id),
            )?.parentThreadId,
        ),
      ).toEqual(["thr_parent", "thr_parent"]);
    });
    expect(cancelQueries).toHaveBeenCalledTimes(4);

    for (const id of ["thr_1", "thr_2"]) {
      pending
        .get(id)
        ?.resolve(makeThreadResponse({ id, parentThreadId: "thr_parent" }));
    }
    await expect(Promise.all(updates)).resolves.toHaveLength(2);
  });

  it("rolls back a plugin thread metadata batch when one update fails", async () => {
    const { sdk, queryClient, threads } = makeSdk();
    threads.update.mockImplementation(({ threadId }: { threadId: string }) =>
      threadId === "thr_1"
        ? Promise.resolve(makeThreadResponse({ id: threadId }))
        : Promise.reject(new Error("update failed")),
    );
    for (const id of ["thr_1", "thr_2"]) {
      queryClient.setQueryData(
        threadQueryKey(id),
        makeThreadWithRuntime({ id, sectionId: "section-a" }),
      );
    }
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);

    const results = await Promise.allSettled(
      ["thr_1", "thr_2"].map((threadId) =>
        bound.threads.update({ threadId, sectionId: "section-b" }),
      ),
    );

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      ["thr_1", "thr_2"].map(
        (id) =>
          queryClient.getQueryData<ReturnType<typeof makeThreadWithRuntime>>(
            threadQueryKey(id),
          )?.sectionId,
      ),
    ).toEqual(["section-a", "section-a"]);
  });

  it.each([
    { label: "rename", name: "Renamed environment" },
    { label: "clear", name: null },
  ])("optimistically applies a plugin environment $label", async ({ name }) => {
    const { sdk, environments, queryClient } = makeSdk();
    const pending = deferred<ReturnType<typeof makeEnvironment>>();
    environments.update.mockReturnValueOnce(pending.promise);
    queryClient.setQueryData(
      environmentQueryKey("env_1"),
      makeEnvironment({ id: "env_1", name: "Original environment" }),
    );
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);

    const update = bound.environments.update({
      environmentId: "env_1",
      name,
    });

    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData<ReturnType<typeof makeEnvironment>>(
          environmentQueryKey("env_1"),
        )?.name,
      ).toBe(name),
    );
    expect(environments.update).toHaveBeenCalledWith({
      environmentId: "env_1",
      name,
    });

    pending.resolve(makeEnvironment({ id: "env_1", name }));
    await expect(update).resolves.toMatchObject({ name });
  });

  it("rolls back a failed plugin environment rename", async () => {
    const { sdk, environments, queryClient } = makeSdk();
    const pending = deferred<ReturnType<typeof makeEnvironment>>();
    environments.update.mockReturnValueOnce(pending.promise);
    queryClient.setQueryData(
      environmentQueryKey("env_1"),
      makeEnvironment({ id: "env_1", name: "Original environment" }),
    );
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);

    const update = bound.environments.update({
      environmentId: "env_1",
      name: "Optimistic environment",
    });

    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData<ReturnType<typeof makeEnvironment>>(
          environmentQueryKey("env_1"),
        )?.name,
      ).toBe("Optimistic environment"),
    );
    pending.reject(new Error("update failed"));

    await expect(update).rejects.toThrow("update failed");
    expect(
      queryClient.getQueryData<ReturnType<typeof makeEnvironment>>(
        environmentQueryKey("env_1"),
      )?.name,
    ).toBe("Original environment");
  });
});

describe("getPluginBoundSdk", () => {
  it("returns one stable client per plugin per underlying sdk", () => {
    const { sdk, queryClient } = makeSdk();
    const other = makeSdk().sdk;
    expect(getPluginBoundSdk(sdk, "a", queryClient)).toBe(
      getPluginBoundSdk(sdk, "a", queryClient),
    );
    expect(getPluginBoundSdk(sdk, "a", queryClient)).not.toBe(
      getPluginBoundSdk(sdk, "b", queryClient),
    );
    expect(getPluginBoundSdk(sdk, "a", queryClient)).not.toBe(
      getPluginBoundSdk(other, "a", queryClient),
    );
  });
});
