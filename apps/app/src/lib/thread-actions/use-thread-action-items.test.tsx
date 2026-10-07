// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  PluginThreadActionContext,
  PluginThreadActionRegistration,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { useThreadActionItems } from "./use-thread-action-items";

const getPluginMetadata = vi.hoisted(() => vi.fn(async () => ({})));
const rpcClients = vi.hoisted(() => new Map<string, { call: ReturnType<typeof vi.fn> }>());

const sidebarActions = vi.hoisted(() => ({
  open: vi.fn(),
  openNewThread: vi.fn(),
  setPinned: vi.fn(async () => undefined),
  setRead: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  archive: vi.fn(),
  requestDelete: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { getPluginMetadata } },
}));

vi.mock("@/lib/plugin-sdk-hooks", () => ({
  createPluginRpcClient: (pluginId: string) => {
    const existing = rpcClients.get(pluginId);
    if (existing) return existing;
    const client = { call: vi.fn() };
    rpcClients.set(pluginId, client);
    return client;
  },
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    requestRename: vi.fn(),
    unarchiveThread: vi.fn(),
  }),
}));

vi.mock("@/lib/plugin-sidebar-hooks", () => ({
  useSidebarThreadActions: () => sidebarActions,
  useResolveSidebarThread: () => () => null,
}));

vi.mock("@/lib/plugin-sidebar-split", () => ({
  useSidebarThreadSplit: () => ({
    isAvailable: true,
    splitProps: {},
    layout: null,
  }),
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

const target: PluginThreadActionTarget = {
  id: "thr_1",
  projectId: "proj_1",
  parentThreadId: null,
  archivedAt: null,
  pinnedAt: null,
  sectionId: null,
  isUnread: false,
  status: "idle",
  environment: null,
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function register(pluginId: string, registrations: PluginThreadActionRegistration[]) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({ threadActions: registrations }),
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  rpcClients.clear();
  getPluginMetadata.mockClear();
  vi.restoreAllMocks();
});

describe("useThreadActionItems", () => {
  it("orders groups, core before plugins within a group, plugins by registration", () => {
    register("b-plugin", [
      {
        id: "late",
        title: "Late",
        resolve: () => ({ label: "Late", icon: "Clock", group: "open", run() {} }),
      },
    ]);
    register("a-plugin", [
      {
        id: "edit",
        title: "Edit",
        resolve: () => ({ label: "Archive note", icon: "Archive", group: "lifecycle", run() {} }),
      },
      {
        id: "first",
        title: "First",
        resolve: () => ({ label: "First", icon: "Star", group: "open", run() {} }),
      },
    ]);
    const { result } = renderHook(() => useThreadActionItems(target, "menu"), {
      wrapper,
    });
    expect(result.current.map((item) => item.key)).toEqual([
      "core:split",
      "a-plugin/first",
      "b-plugin/late",
      "core:copyLink",
      "core:read",
      "core:pin",
      "core:rename",
      "core:archive",
      "core:delete",
      "a-plugin/edit",
    ]);
    expect(result.current.find((item) => item.key === "a-plugin/edit")?.pluginId).toBe(
      "a-plugin",
    );
  });

  it("hides a plugin action that resolves null and one that sets both run and choices", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    register("notes", [
      { id: "hidden", title: "Hidden", resolve: () => null },
      {
        id: "both",
        title: "Both",
        resolve: () => ({
          label: "Both",
          icon: "Star",
          group: "organize",
          run() {},
          choices: { items: [], select() {} },
        }),
      },
      {
        id: "button-only",
        title: "Button only",
        resolve: ({ surface }) =>
          surface === "button"
            ? { label: "Quick", icon: "Zap", group: "organize", run() {} }
            : null,
      },
    ]);
    const menu = renderHook(() => useThreadActionItems(target, "menu"), {
      wrapper,
    });
    expect(menu.result.current.some((item) => item.pluginId !== null)).toBe(false);
    const button = renderHook(() => useThreadActionItems(target, "button"), {
      wrapper,
    });
    expect(
      button.result.current.filter((item) => item.pluginId !== null).map((item) => item.key),
    ).toEqual(["notes/button-only"]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"both" must set exactly one of "run" and "choices"'),
    );
  });

  it("hands each plugin its own rpc client and refetches its metadata after run or select settles", async () => {
    const contexts: PluginThreadActionContext[] = [];
    register("notes", [
      {
        id: "star",
        title: "Star",
        resolve: (context) => {
          contexts.push(context);
          return { label: "Star", icon: "Star", group: "organize", run: async () => undefined };
        },
      },
      {
        id: "level",
        title: "Level",
        resolve: () => ({
          label: "Level",
          icon: "Bell",
          group: "organize",
          choices: {
            items: [{ id: "muted", label: "Muted" }],
            select: () => {
              throw new Error("boom");
            },
          },
        }),
      },
    ]);
    const { result } = renderHook(() => useThreadActionItems(target, "menu"), {
      wrapper,
    });
    await waitFor(() => expect(getPluginMetadata).toHaveBeenCalledTimes(1));
    expect(contexts[0]?.rpc).toBe(rpcClients.get("notes"));

    const star = result.current.find((item) => item.key === "notes/star");
    await act(async () => {
      await star?.action.run?.();
    });
    await waitFor(() => expect(getPluginMetadata).toHaveBeenCalledTimes(2));

    const level = result.current.find((item) => item.key === "notes/level");
    await act(async () => {
      await expect(level?.action.choices?.select("muted")).rejects.toThrow("boom");
    });
    await waitFor(() => expect(getPluginMetadata).toHaveBeenCalledTimes(3));
    expect(getPluginMetadata).toHaveBeenLastCalledWith(
      expect.objectContaining({ pluginId: "notes", threadId: target.id }),
    );
  });

  it("gives every caller the same list for the same target", () => {
    register("notes", [
      {
        id: "star",
        title: "Star",
        resolve: () => ({ label: "Star", icon: "Star", group: "organize", run() {} }),
      },
    ]);
    const header = renderHook(() => useThreadActionItems(target, "menu"), {
      wrapper,
    });
    const sidebar = renderHook(() => useThreadActionItems({ ...target }, "menu"), {
      wrapper,
    });
    const describe = (items: typeof header.result.current) =>
      items.map((item) => [item.key, item.action.label, item.action.group]);
    expect(describe(sidebar.result.current)).toEqual(describe(header.result.current));
  });
});
