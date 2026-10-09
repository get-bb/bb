import type { BbSdkAreas } from "@bb/sdk";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  makeEnvironment,
  makeThreadWithRuntime,
  makeThreadListEntry,
  makeHost,
} from "@bb/test-helpers/domain-fixtures";
import {
  environmentQueryKey,
  hostsQueryKey,
  hostQueryKey,
  projectsQueryKey,
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "@/hooks/queries/query-keys";
import {
  makeSidebarBootstrapResponse,
  makeProjectWithThreadsResponse,
} from "@/test/fixtures/projects";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { bindSdkToPlugin, getPluginBoundSdk } from "./plugin-bound-sdk";
import { createDeferredPromise } from "@bb/test-helpers";

function makeSdk() {
  const threads = {
    spawn: vi.fn(async (args: unknown) => args),
    fork: vi.fn(async (args: unknown) => args),
    getPluginMetadata: vi.fn(async (args: unknown) => args),
    updatePluginMetadata: vi.fn(async (args: unknown) => args),
    update: vi.fn(async ({ threadId }: { threadId: string }) =>
      makeThreadResponse({ id: threadId }),
    ),
    pin: vi.fn(async ({ threadId }: { threadId: string }) =>
      makeThreadResponse({ id: threadId, pinnedAt: 1 }),
    ),
    unpin: vi.fn(async ({ threadId }: { threadId: string }) =>
      makeThreadResponse({ id: threadId, pinnedAt: null }),
    ),
    reorderPinned: vi.fn(
      async (_args: {
        threadId: string;
        previousThreadId: string | null;
        nextThreadId: string | null;
      }) => [
        makeThreadListEntry({
          id: "thr_reorder",
          pinnedAt: 1,
          pinSortKey: "a",
        }),
      ],
    ),
    unarchive: vi.fn(async (_args: { threadId: string }) => ({
      ok: true as const,
    })),
  };
  const environments = {
    archiveThreads: vi.fn(async (_args: { environmentId: string }) => ({
      ok: true as const,
      archivedThreadIds: ["thr_1", "thr_2", "thr_child", "thr_grandchild"],
    })),
    update: vi.fn(async (args: { name?: string | null }) =>
      makeEnvironment({ id: "env_1", name: args.name ?? null }),
    ),
  };
  const threadSections = {
    create: vi.fn(async ({ name }: { name: string }) => ({
      id: "sec_created",
      name,
      createdAt: 0,
      updatedAt: 0,
    })),
    update: vi.fn(async ({ id, name }: { id: string; name: string }) => ({
      id,
      name,
      updatedThreadCount: 0,
    })),
    delete: vi.fn(async ({ id }: { id: string }) => ({
      id,
      name: "Section",
      updatedThreadCount: 1,
    })),
  };
  const projects = {
    update: vi.fn(
      async ({ projectId, name }: { projectId: string; name: string }) =>
        makeProjectWithThreadsResponse({ id: projectId, name }),
    ),
    delete: vi.fn(async (_args: { projectId: string }) => ({
      ok: true as const,
    })),
  };
  const hosts = {
    update: vi.fn(async ({ hostId, name }: { hostId: string; name: string }) =>
      makeHost({ id: hostId, name }),
    ),
  };
  return {
    sdk: {
      environments,
      threads,
      threadSections,
      projects,
      hosts,
    } as unknown as BbSdkAreas,
    environments,
    projects,
    hosts,
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

  it("preserves SDK arguments while applying cache updates", async () => {
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
      ReturnType<
        typeof createDeferredPromise<ReturnType<typeof makeThreadResponse>>
      >
    >();
    threads.update.mockImplementation(({ threadId }: { threadId: string }) => {
      const request =
        createDeferredPromise<ReturnType<typeof makeThreadResponse>>();
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

  it("keeps an in-flight move over refetched sidebar data until the write settles", async () => {
    const { sdk, queryClient, threads } = makeSdk();
    const request =
      createDeferredPromise<ReturnType<typeof makeThreadResponse>>();
    threads.update.mockImplementation(() => request.promise);
    const sidebarKey = sidebarNavigationQueryKey();
    const serverNavigation = (sectionId: string) =>
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({
            threads: [
              makeThreadListEntry({ id: "thr_moved", sectionId }),
              makeThreadListEntry({
                id: "thr_child",
                parentThreadId: "thr_moved",
              }),
            ],
          }),
        ],
      });
    const sidebarSectionId = () =>
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarKey)
        ?.projects[0]?.threads.find((thread) => thread.id === "thr_moved")
        ?.sectionId;
    const refetchSidebar = (sectionId: string) =>
      queryClient.fetchQuery({
        queryKey: sidebarKey,
        queryFn: async () => serverNavigation(sectionId),
        staleTime: 0,
      });
    queryClient.setQueryData(sidebarKey, serverNavigation("section-a"));
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);

    const update = bound.threads.update({
      threadId: "thr_moved",
      sectionId: "section-b",
    });
    await vi.waitFor(() => expect(sidebarSectionId()).toBe("section-b"));

    await refetchSidebar("section-a");
    expect(sidebarSectionId()).toBe("section-b");
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarKey)
        ?.projects[0]?.threads.map((thread) => thread.id),
    ).toContain("thr_child");

    request.resolve(
      makeThreadResponse({ id: "thr_moved", sectionId: "section-b" }),
    );
    await update;
    await refetchSidebar("section-a");
    expect(sidebarSectionId()).toBe("section-a");
    queryClient.clear();
  });

  it("applies the server's pinned order before the caller clears its drag preview", async () => {
    const { sdk, queryClient } = makeSdk();
    const entry = makeThreadListEntry({
      id: "thr_reorder",
      pinnedAt: 1,
      pinSortKey: "z",
    });
    const sidebarKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(
      sidebarKey,
      makeSidebarBootstrapResponse({
        projects: [makeProjectWithThreadsResponse({ threads: [entry] })],
      }),
    );
    const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
    await bound.threads
      .reorderPinned({
        threadId: entry.id,
        previousThreadId: null,
        nextThreadId: null,
      })
      .then(() => {
        expect(
          queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey)
            ?.projects[0]?.threads[0]?.pinSortKey,
        ).toBe("a");
      });
    queryClient.clear();
  });

  it.each(["success", "failure"])(
    "restores an archived sidebar thread optimistically on %s",
    async (outcome) => {
      const { sdk, queryClient, threads } = makeSdk();
      const entry = makeThreadListEntry({
        id: "thr_restore",
        projectId: "proj_1",
        archivedAt: 1,
      });
      const listKey = threadListQueryKey({
        projectId: "proj_1",
        archived: true,
      });
      const sidebarKey = sidebarNavigationQueryKey();
      queryClient.setQueryData(listKey, [entry]);
      queryClient.setQueryData(
        sidebarKey,
        makeSidebarBootstrapResponse({
          projects: [
            makeProjectWithThreadsResponse({ id: "proj_1", threads: [] }),
          ],
        }),
      );
      const pending = createDeferredPromise<{ ok: true }>();
      threads.unarchive.mockReturnValueOnce(pending.promise);
      const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
      const restore = bound.threads.unarchive({ threadId: entry.id });
      await vi.waitFor(() => {
        expect(queryClient.getQueryData<(typeof entry)[]>(listKey)).toEqual([]);
        expect(
          queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey)
            ?.projects[0]?.threads,
        ).toMatchObject([{ id: entry.id, archivedAt: null }]);
      });
      if (outcome === "failure") {
        pending.reject(new Error("restore failed"));
        await expect(restore).rejects.toThrow("restore failed");
        expect(queryClient.getQueryData<(typeof entry)[]>(listKey)).toEqual([
          entry,
        ]);
        expect(
          queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey)
            ?.projects[0]?.threads,
        ).toEqual([]);
      } else {
        pending.resolve({ ok: true });
        await restore;
      }
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      queryClient.clear();
    },
  );

  it.each(["success", "failure"])(
    "moves a pinned thread immediately and reconciles %s",
    async (outcome) => {
      const { sdk, queryClient, threads } = makeSdk();
      const entry = makeThreadListEntry({
        id: "thr_move",
        pinnedAt: 1,
        sectionId: "old",
      });
      const sidebarKey = sidebarNavigationQueryKey();
      queryClient.setQueryData(
        sidebarKey,
        makeSidebarBootstrapResponse({
          projects: [makeProjectWithThreadsResponse({ threads: [entry] })],
        }),
      );
      const pending =
        createDeferredPromise<ReturnType<typeof makeThreadResponse>>();
      threads.unpin.mockReturnValueOnce(pending.promise);
      threads.update.mockResolvedValueOnce(
        makeThreadResponse({ id: entry.id, pinnedAt: null, sectionId: "new" }),
      );
      const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
      const moved = Promise.all([
        bound.threads.unpin({ threadId: entry.id }),
        bound.threads.update({ threadId: entry.id, sectionId: "new" }),
      ]);
      const current = () =>
        queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey)
          ?.projects[0]?.threads[0];
      await vi.waitFor(() =>
        expect(current()).toMatchObject({ pinnedAt: null, sectionId: "new" }),
      );
      expect(threads.update).not.toHaveBeenCalled();
      if (outcome === "failure") {
        pending.reject(new Error("unpin failed"));
        await expect(moved).rejects.toThrow("unpin failed");
        expect(current()).toMatchObject({ pinnedAt: 1, sectionId: "old" });
        expect(threads.update).not.toHaveBeenCalled();
      } else {
        pending.resolve(
          makeThreadResponse({
            id: entry.id,
            pinnedAt: null,
            sectionId: "old",
          }),
        );
        await moved;
        expect(current()).toMatchObject({ pinnedAt: null, sectionId: "new" });
      }
      queryClient.clear();
    },
  );

  it.each(["project", "host", "section"])(
    "renames a %s in shared sidebar caches before the server responds and rolls back failure",
    async (kind) => {
      const { sdk, queryClient, projects, hosts, threadSections } = makeSdk();
      const project = makeProjectWithThreadsResponse({
        id: "proj_1",
        name: "Project",
      });
      const host = makeHost({ id: "host_1", name: "Machine" });
      const section = {
        id: "sec_1",
        name: "Section",
        createdAt: 0,
        updatedAt: 0,
      };
      const sidebarKey = sidebarNavigationQueryKey();
      queryClient.setQueryData(
        sidebarKey,
        makeSidebarBootstrapResponse({
          projects: [project],
          sections: [section],
        }),
      );
      queryClient.setQueryData(projectsQueryKey(), [project]);
      queryClient.setQueryData(hostsQueryKey(), [host]);
      queryClient.setQueryData(hostQueryKey(host.id), host);
      const pending = createDeferredPromise<never>();
      const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
      const current = () =>
        kind === "host"
          ? queryClient.getQueryData<(typeof host)[]>(hostsQueryKey())?.[0]
              ?.name
          : kind === "project"
            ? queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey)
                ?.projects[0]?.name
            : queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey)
                ?.sections[0]?.name;
      let rename;
      if (kind === "host") {
        hosts.update.mockReturnValueOnce(pending.promise);
        rename = bound.hosts.update({ hostId: host.id, name: "New name" });
      } else if (kind === "project") {
        projects.update.mockReturnValueOnce(pending.promise);
        rename = bound.projects.update({
          projectId: project.id,
          name: "New name",
        });
      } else {
        threadSections.update.mockReturnValueOnce(pending.promise);
        rename = bound.threadSections.update({
          id: section.id,
          name: "New name",
        });
      }
      await vi.waitFor(() => expect(current()).toBe("New name"));
      pending.reject(new Error("rename failed"));
      await expect(rename).rejects.toThrow("rename failed");
      expect(current()).toBe(
        kind === "host"
          ? "Machine"
          : kind === "project"
            ? "Project"
            : "Section",
      );
      queryClient.clear();
    },
  );

  it.each(["project", "section"])(
    "removes a %s immediately and restores it on failure without losing unrelated changes",
    async (kind) => {
      const { sdk, queryClient, projects, threadSections } = makeSdk();
      const entry = makeThreadListEntry({
        id: "thr_section",
        sectionId: "sec_1",
      });
      const project = makeProjectWithThreadsResponse({
        id: "proj_1",
        threads: [entry],
      });
      const unrelated = makeProjectWithThreadsResponse({
        id: "proj_other",
        name: "Unrelated",
      });
      const section = {
        id: "sec_1",
        name: "Section",
        createdAt: 0,
        updatedAt: 0,
      };
      const sidebarKey = sidebarNavigationQueryKey();
      queryClient.setQueryData(
        sidebarKey,
        makeSidebarBootstrapResponse({
          projects: [project, unrelated],
          sections: [section],
        }),
      );
      const pending = createDeferredPromise<never>();
      const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
      let removal;
      if (kind === "project") {
        projects.delete.mockReturnValueOnce(pending.promise);
        removal = bound.projects.delete({ projectId: project.id });
      } else {
        threadSections.delete.mockReturnValueOnce(pending.promise);
        removal = bound.threadSections.delete({ id: section.id });
      }
      await vi.waitFor(() => {
        const sidebar =
          queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey);
        if (kind === "project")
          expect(sidebar?.projects.map((p) => p.id)).toEqual([unrelated.id]);
        else {
          expect(sidebar?.sections).toEqual([]);
          expect(sidebar?.projects[0]?.threads[0]?.sectionId).toBeNull();
        }
      });
      queryClient.setQueryData<SidebarBootstrapResponse>(
        sidebarKey,
        (current) =>
          current
            ? {
                ...current,
                projects: current.projects.map((p) =>
                  p.id === unrelated.id
                    ? { ...p, name: "Concurrent rename" }
                    : p,
                ),
              }
            : current,
      );
      pending.reject(new Error("remove failed"));
      await expect(removal).rejects.toThrow("remove failed");
      const sidebar =
        queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey);
      expect(sidebar?.projects.map((p) => p.id)).toEqual([
        project.id,
        unrelated.id,
      ]);
      expect(sidebar?.projects[0]?.threads[0]?.sectionId).toBe("sec_1");
      expect(sidebar?.sections).toEqual([section]);
      expect(sidebar?.projects[1]?.name).toBe("Concurrent rename");
      queryClient.clear();
    },
  );

  it.each(["success", "failure"])(
    "optimistically archives a worktree group and reconciles %s",
    async (outcome) => {
      const { sdk, environments, queryClient } = makeSdk();
      const pending =
        createDeferredPromise<
          Awaited<ReturnType<typeof sdk.environments.archiveThreads>>
        >();
      environments.archiveThreads.mockReturnValueOnce(pending.promise);
      const entries = [
        makeThreadListEntry({ id: "thr_1", environmentId: "env_1" }),
        makeThreadListEntry({ id: "thr_2", environmentId: "env_1" }),
        makeThreadListEntry({
          id: "thr_child",
          environmentId: "env_2",
          parentThreadId: "thr_1",
        }),
        makeThreadListEntry({
          id: "thr_grandchild",
          environmentId: "env_2",
          parentThreadId: "thr_child",
        }),
        makeThreadListEntry({ id: "thr_other", environmentId: "env_2" }),
        makeThreadListEntry({
          id: "thr_archived",
          environmentId: "env_1",
          archivedAt: 1,
        }),
      ];
      const sidebarKey = sidebarNavigationQueryKey();
      const listKey = threadListQueryKey({
        projectId: "proj_1",
        archived: false,
      });
      queryClient.setQueryData(
        sidebarKey,
        makeSidebarBootstrapResponse({
          projects: [
            makeProjectWithThreadsResponse({
              id: "proj_1",
              threads: entries.slice(0, 3),
            }),
          ],
        }),
      );
      queryClient.setQueryData(listKey, entries);
      queryClient.setQueryData(
        threadQueryKey("thr_1"),
        makeThreadWithRuntime({
          id: "thr_1",
          environmentId: "env_1",
          archivedAt: null,
        }),
      );
      const bound = bindSdkToPlugin(sdk, "thread-list", queryClient);
      const archive = bound.environments.archiveThreads({
        environmentId: "env_1",
      });
      const sidebarIds = () =>
        queryClient
          .getQueryData<SidebarBootstrapResponse>(sidebarKey)
          ?.projects[0]?.threads.map((thread) => thread.id);
      const listIds = () =>
        queryClient
          .getQueryData<typeof entries>(listKey)
          ?.map((thread) => thread.id);

      await vi.waitFor(() => {
        expect(sidebarIds()).toEqual([]);
        expect(listIds()).toEqual(["thr_other", "thr_archived"]);
      });
      expect(environments.archiveThreads).toHaveBeenCalledWith({
        environmentId: "env_1",
      });
      expect(
        queryClient.getQueryData<ReturnType<typeof makeThreadWithRuntime>>(
          threadQueryKey("thr_1"),
        )?.archivedAt,
      ).toEqual(expect.any(Number));
      queryClient.setQueryData<typeof entries>(listKey, (list) =>
        list?.map((thread) =>
          thread.id === "thr_other"
            ? { ...thread, title: "Concurrent rename" }
            : thread,
        ),
      );

      if (outcome === "failure") {
        pending.reject(new Error("archive failed"));
        await expect(archive).rejects.toThrow("archive failed");
        expect(sidebarIds()).toEqual(["thr_1", "thr_2", "thr_child"]);
        expect(listIds()).toEqual(entries.map((thread) => thread.id));
        expect(
          queryClient.getQueryData<ReturnType<typeof makeThreadWithRuntime>>(
            threadQueryKey("thr_1"),
          )?.archivedAt,
        ).toBeNull();
      } else {
        pending.resolve({
          ok: true,
          archivedThreadIds: ["thr_1", "thr_2", "thr_child", "thr_grandchild"],
        });
        await expect(archive).resolves.toMatchObject({ ok: true });
        expect(sidebarIds()).toEqual([]);
        expect(listIds()).toEqual(["thr_other", "thr_archived"]);
      }
      expect(
        queryClient
          .getQueryData<typeof entries>(listKey)
          ?.find((thread) => thread.id === "thr_other")?.title,
      ).toBe("Concurrent rename");
      expect(queryClient.getQueryState(sidebarKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      queryClient.clear();
    },
  );

  it.each([
    { label: "rename", name: "Renamed environment" },
    { label: "clear", name: null },
  ])("optimistically applies a plugin environment $label", async ({ name }) => {
    const { sdk, environments, queryClient } = makeSdk();
    const pending = createDeferredPromise<ReturnType<typeof makeEnvironment>>();
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
    const pending = createDeferredPromise<ReturnType<typeof makeEnvironment>>();
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
