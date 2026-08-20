import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "@/lib/query/query-keys";
import {
  project,
  sidebarBootstrap,
  threadListEntry,
  threadResponse,
} from "../test/fixtures";
import {
  buildSenderThreadMetadataById,
  createSenderThreadMetadataStore,
  isPluginSideChatSenderThread,
} from "./sender-thread-metadata";

describe("buildSenderThreadMetadataById", () => {
  it("prefers the sidebar title, fills gaps from thread and list caches, and never downgrades a title", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      sidebarBootstrap({
        projects: [
          project({
            id: "proj_1",
            threads: [threadListEntry({ id: "a", title: "Sidebar A" })],
          }),
        ],
      }),
    );
    queryClient.setQueryData(
      threadQueryKey("a"),
      threadResponse({ id: "a", title: "Stale detail A" }),
    );
    queryClient.setQueryData(
      threadQueryKey("b"),
      threadResponse({ id: "b", title: "  ", titleFallback: "Fallback B" }),
    );
    queryClient.setQueryData(
      threadListQueryKey({ archived: false, parentThreadId: "root" }),
      [
        threadListEntry({ id: "b", title: null, titleFallback: null }),
        threadListEntry({ id: "c", title: "Child C", originKind: "fork" }),
      ],
    );

    const map = buildSenderThreadMetadataById(queryClient);
    expect(map.get("a")?.title).toBe("Sidebar A");
    expect(map.get("b")?.title).toBe("Fallback B");
    expect(map.get("c")).toEqual({
      title: "Child C",
      originKind: "fork",
      originPluginId: null,
      visibility: "visible",
    });
  });
});

describe("createSenderThreadMetadataStore", () => {
  it("publishes a new snapshot only when a relevant cache update changes the map", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      threadQueryKey("a"),
      threadResponse({ id: "a", title: "A" }),
    );
    const scheduled: Array<() => void> = [];
    const store = createSenderThreadMetadataStore(queryClient, (run) =>
      scheduled.push(run),
    );
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    const flush = () => {
      for (const run of scheduled.splice(0)) run();
    };
    flush();
    const initial = store.getSnapshot();
    expect(initial.get("a")?.title).toBe("A");
    expect(notifications).toBe(0);

    // Same data written again: the rebuilt map is value-equal → no publish.
    queryClient.setQueryData(
      threadQueryKey("a"),
      threadResponse({ id: "a", title: "A" }),
    );
    flush();
    expect(store.getSnapshot()).toBe(initial);
    expect(notifications).toBe(0);

    // A rename publishes a fresh map.
    queryClient.setQueryData(
      threadQueryKey("a"),
      threadResponse({ id: "a", title: "Renamed" }),
    );
    flush();
    expect(store.getSnapshot()).not.toBe(initial);
    expect(store.getSnapshot().get("a")?.title).toBe("Renamed");
    expect(notifications).toBe(1);

    // Unrelated queries never trigger a rebuild.
    queryClient.setQueryData(["hosts"], [{ id: "h" }]);
    expect(scheduled).toHaveLength(0);

    unsubscribe();
    queryClient.setQueryData(
      threadQueryKey("a"),
      threadResponse({ id: "a", title: "After unsubscribe" }),
    );
    expect(scheduled).toHaveLength(0);
  });
});

describe("isPluginSideChatSenderThread", () => {
  it("matches only hidden forks owned by the side-chat plugin", () => {
    expect(
      isPluginSideChatSenderThread({
        title: null,
        originKind: "fork",
        originPluginId: "side-chat",
        visibility: "hidden",
      }),
    ).toBe(true);
    expect(
      isPluginSideChatSenderThread({
        title: null,
        originKind: "fork",
        originPluginId: "side-chat",
        visibility: "visible",
      }),
    ).toBe(false);
    expect(isPluginSideChatSenderThread(null)).toBe(false);
  });
});
