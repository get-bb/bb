// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  useSidebarThreadActions,
  useSidebarThreadDraft,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  useSidebarThreads,
} from "./plugin-sidebar-hooks";
import {
  clearPluginThreadRowStatuses,
  setPluginThreadRowStatus,
} from "./plugin-thread-row-status";
import { useEnvironmentProviders } from "./plugin-sdk-hooks";
import { SidebarThreadShortcutKeysContext } from "@/components/sidebar/sidebarThreadShortcuts";

const actions = vi.hoisted(() => ({
  navigate: vi.fn(),
  setRootComposeProjectId: vi.fn(),
}));

type SidebarSection = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

const state = vi.hoisted(() => ({
  data: undefined as
    | {
        sections: SidebarSection[];
        projects: { id: string; name: string; threads: ThreadListEntry[] }[];
        personalProject: {
          id: string;
          name: string;
          threads: ThreadListEntry[];
        };
      }
    | undefined,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: state.data, isError: false }),
}));

vi.mock("@/hooks/queries/host-queries", () => {
  const hosts: never[] = [];
  return { useHosts: () => ({ data: hosts }) };
});

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: vi.fn(),
    requestDelete: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useUpdateThread: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => actions.navigate,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("./root-compose-selection", () => ({
  useSetRootComposeProjectId: () => actions.setRootComposeProjectId,
}));

const environmentProviders = vi.hoisted(() => ({
  providers: undefined as readonly Record<string, unknown>[] | undefined,
}));

vi.mock("@/hooks/queries/environment-provider-queries", () => ({
  useSystemEnvironmentProviders: () => ({
    providers: environmentProviders.providers,
  }),
}));

const drafts = vi.hoisted(() => ({
  threadIds: new Set<string>(),
  listeners: new Set<() => void>(),
  notify() {
    for (const listener of drafts.listeners) listener();
  },
}));

vi.mock("@/hooks/usePromptDraftStorage", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    drafts.listeners.add(listener);
    return () => drafts.listeners.delete(listener);
  };
  return {
    usePromptDraftHasInput: (scope: { threadId: string }) =>
      useSyncExternalStore(subscribe, () => drafts.threadIds.has(scope.threadId)),
    usePromptDraftInputThreadIds: (threads: readonly { id: string }[]) => {
      const snapshot = useSyncExternalStore(subscribe, () =>
        threads
          .map((thread) => (drafts.threadIds.has(thread.id) ? "1" : "0"))
          .join(""),
      );
      return new Set(
        threads.filter((_, index) => snapshot[index] === "1").map((t) => t.id),
      );
    },
  };
});

function payload(threads: ThreadListEntry[], sections: SidebarSection[] = []) {
  return {
    sections,
    projects: [{ id: "proj_app", name: "App", threads }],
    personalProject: { id: PERSONAL_PROJECT_ID, name: "Personal", threads: [] },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.data = undefined;
  drafts.threadIds.clear();
  clearPluginThreadRowStatuses("plugin-a");
  environmentProviders.providers = undefined;
});

describe("useSidebarThreads", () => {
  it("keeps DTO identity for entries that did not change across a sidebar update", () => {
    const stable = makeThreadListEntry({ id: "thr_stable", title: "Stable" });
    const changing = makeThreadListEntry({ id: "thr_changing", title: "One" });
    state.data = payload([stable, changing]);
    const { result, rerender } = renderHook(() => useSidebarThreads());
    const before = result.current.threads;
    expect(before.map((thread) => thread.id)).toEqual([
      "thr_stable",
      "thr_changing",
    ]);

    state.data = payload([
      stable,
      makeThreadListEntry({ id: "thr_changing", title: "Two" }),
    ]);
    rerender();
    const after = result.current.threads;
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.title).toBe("Two");
  });

  it("shares DTO identity between two consumers of the same payload", () => {
    const stable = makeThreadListEntry({ id: "thr_stable", title: "Stable" });
    state.data = payload([stable]);
    const first = renderHook(() => useSidebarThreads());
    const second = renderHook(() => useSidebarThreads());
    expect(second.result.current.threads[0]).toBe(
      first.result.current.threads[0],
    );
    const before = first.result.current.threads[0];
    first.rerender();
    second.rerender();
    expect(first.result.current.threads[0]).toBe(before);
    expect(second.result.current.threads[0]).toBe(before);
  });
});

describe("useSidebarThreads sections", () => {
  it("passes the bootstrap sections through in server order", () => {
    const sections = [
      { id: "sec_later", name: "Later", createdAt: 1, updatedAt: 1 },
      { id: "sec_slop", name: "Slop Cop", createdAt: 2, updatedAt: 2 },
    ];
    state.data = payload([], sections);
    const { result } = renderHook(() => useSidebarThreads());
    expect(result.current.sections).toEqual(sections);
  });

  it("reports an empty section list while loading", () => {
    const { result } = renderHook(() => useSidebarThreads());
    expect(result.current.status).toBe("loading");
    expect(result.current.sections).toEqual([]);
  });
});

describe("useSidebarThreadActions", () => {
  it("opens a project composer without a legacy route transition", () => {
    state.data = payload([]);
    const { result } = renderHook(() => useSidebarThreadActions());

    act(() => {
      result.current.openNewThread({
        projectId: "proj_target",
        focusPrompt: true,
      });
    });

    expect(actions.setRootComposeProjectId).toHaveBeenCalledWith("proj_target");
    expect(actions.navigate).toHaveBeenCalledWith("/", {
      state: { focusPrompt: true },
    });
  });

  it("files a new thread under a section the way bb's section menu does", () => {
    state.data = payload([]);
    const { result } = renderHook(() => useSidebarThreadActions());

    act(() => {
      result.current.openNewThread({
        projectId: PERSONAL_PROJECT_ID,
        sectionId: "sec_later",
        focusPrompt: true,
      });
    });

    expect(actions.navigate).toHaveBeenCalledWith("/", {
      state: { focusPrompt: true, sectionId: "sec_later" },
    });
  });

  it("reuses an environment the way bb's environment header does", () => {
    state.data = payload([]);
    const { result } = renderHook(() => useSidebarThreadActions());

    act(() => {
      result.current.openNewThread({
        projectId: "proj_app",
        environmentId: "env_1",
      });
    });

    expect(actions.navigate).toHaveBeenCalledWith("/", {
      state: { reuseEnvironmentId: "env_1" },
    });
  });

  it("navigates with no router state when no option is set", () => {
    state.data = payload([]);
    const { result } = renderHook(() => useSidebarThreadActions());
    act(() => {
      result.current.openNewThread();
    });
    expect(actions.navigate).toHaveBeenCalledWith("/", undefined);
  });

  it("re-expands a collapsed conversation when opening its thread", () => {
    const thread = makeThreadListEntry({ id: "thr_1", projectId: "proj_app" });
    state.data = payload([thread]);
    const store = getDefaultStore();
    const collapsedAtom = getThreadConversationCollapsedAtom("thr_1");
    store.set(collapsedAtom, true);
    const { result } = renderHook(() => useSidebarThreadActions());

    act(() => {
      result.current.open("thr_1");
    });

    expect(store.get(collapsedAtom)).toBe(false);
    expect(actions.navigate).toHaveBeenCalledWith(
      "/projects/proj_app/threads/thr_1",
    );
  });

  it("ignores open for an unknown thread", () => {
    state.data = payload([]);
    const { result } = renderHook(() => useSidebarThreadActions());
    act(() => {
      result.current.open("thr_missing");
    });
    expect(actions.navigate).not.toHaveBeenCalled();
  });
});

describe("per-row client state hooks", () => {
  it("reports an unsent draft for a known thread and false otherwise", () => {
    const thread = makeThreadListEntry({ id: "thr_1", projectId: "proj_app" });
    state.data = payload([thread]);
    drafts.threadIds.add("thr_1");
    drafts.threadIds.add("thr_unknown");

    const known = renderHook(() => useSidebarThreadDraft("thr_1"));
    const unknown = renderHook(() => useSidebarThreadDraft("thr_unknown"));
    expect(known.result.current.hasUnsubmittedDraft).toBe(true);
    expect(unknown.result.current.hasUnsubmittedDraft).toBe(false);

    act(() => {
      drafts.threadIds.delete("thr_1");
      drafts.notify();
    });
    expect(known.result.current.hasUnsubmittedDraft).toBe(false);
  });

  it("collects every sidebar thread holding a draft", () => {
    state.data = payload([
      makeThreadListEntry({ id: "thr_1", projectId: "proj_app" }),
      makeThreadListEntry({ id: "thr_2", projectId: "proj_app" }),
    ]);
    drafts.threadIds.add("thr_2");
    const { result } = renderHook(() => useSidebarThreadDraftIds());
    expect([...result.current]).toEqual(["thr_2"]);

    act(() => {
      drafts.threadIds.add("thr_1");
      drafts.notify();
    });
    expect([...result.current].sort()).toEqual(["thr_1", "thr_2"]);
  });

  it("reads and tracks a row status set by another plugin", () => {
    const { result } = renderHook(() => useSidebarThreadRowStatus("thr_1"));
    expect(result.current).toBeNull();

    act(() => {
      setPluginThreadRowStatus("thr_1", "plugin-a", {
        icon: "Loading",
        label: "Drafting",
        tone: "running",
      });
    });
    expect(result.current).toEqual({
      icon: "Loading",
      label: "Drafting",
      tone: "running",
    });

    act(() => {
      setPluginThreadRowStatus("thr_1", "plugin-a", null);
    });
    expect(result.current).toBeNull();
  });

  it("reports the assigned shortcut only while the host provides one", () => {
    const withoutProvider = renderHook(() => useSidebarThreadShortcut("thr_1"));
    expect(withoutProvider.result.current).toBeNull();

    const keys = new Map([
      ["thr_1", { label: "⌘1", ariaKeyshortcuts: "Meta+1" }],
    ]);
    const { result } = renderHook(() => useSidebarThreadShortcut("thr_1"), {
      wrapper: ({ children }) => (
        <SidebarThreadShortcutKeysContext.Provider value={keys}>
          {children}
        </SidebarThreadShortcutKeysContext.Provider>
      ),
    });
    expect(result.current).toEqual({ label: "⌘1", ariaKeyshortcuts: "Meta+1" });
    const other = renderHook(() => useSidebarThreadShortcut("thr_2"), {
      wrapper: ({ children }) => (
        <SidebarThreadShortcutKeysContext.Provider value={keys}>
          {children}
        </SidebarThreadShortcutKeysContext.Provider>
      ),
    });
    expect(other.result.current).toBeNull();
  });
});

describe("useEnvironmentProviders", () => {
  it("reports loading until the catalog resolves, then a narrowed row per provider", () => {
    const { result, rerender } = renderHook(() => useEnvironmentProviders());
    expect(result.current).toEqual({ status: "loading", providers: [] });

    environmentProviders.providers = [
      {
        id: "git-worktree",
        displayName: "Git worktree",
        description: "A worktree per thread",
        icon: "GitBranch",
        logoUrl: null,
        pluginId: "environment-git-worktree",
        machineProviderId: null,
        requires: {},
        inputs: null,
        acceptsEmptyInputs: true,
        availability: null,
        machineAvailability: {},
      },
    ];
    rerender();
    expect(result.current).toEqual({
      status: "ready",
      providers: [
        {
          id: "git-worktree",
          displayName: "Git worktree",
          description: "A worktree per thread",
          icon: "GitBranch",
          logoUrl: null,
          pluginId: "environment-git-worktree",
          machineProviderId: null,
        },
      ],
    });
  });
});
