// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbNavigate,
  PluginBrowserBbSdk,
  PluginThreadAction,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { makePluginProject, sdkResult } from "../model/fixtures.js";
import {
  preferenceValueAtom,
  resetPreferencesSyncForTest,
} from "../preferences/preferences-sync.js";

installTestPluginRuntime();
const { useBbNavigate, useSdk } = await import("@get-bb/plugin-sdk/app");
const { moveThreadAction } = await import("./moveThreadAction.js");

afterEach(() => {
  cleanup();
  resetPreferencesSyncForTest();
});

function makeSection(id: string, name: string) {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

function makeTarget(
  overrides: Partial<PluginThreadActionTarget> = {},
): PluginThreadActionTarget {
  return {
    id: "thr_move",
    projectId: "proj_test",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    sectionId: "sec_a",
    isUnread: false,
    status: "idle",
    environment: null,
    ...overrides,
  };
}

interface Collected {
  item(thread: PluginThreadActionTarget): PluginThreadAction | null;
}

function Probe({ collected }: { collected: { current: Collected | null } }) {
  const useData = moveThreadAction.useData;
  if (useData === undefined) throw new Error("Move reads its destinations");
  const data = useData();
  const sdk: PluginBrowserBbSdk = useSdk();
  const navigate: BbNavigate = useBbNavigate();
  collected.current = {
    item: (thread) => moveThreadAction.item({ thread, data, sdk, navigate }),
  };
  return null;
}

function StoreHarness({
  children,
  store,
}: {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}) {
  return <Provider store={store}>{children}</Provider>;
}

function renderMove(
  organizationMode: "chronological" | "project" = "chronological",
) {
  const store = createStore();
  const collected: { current: Collected | null } = { current: null };
  const unpin = vi.fn(sdkResult({ ok: true }));
  const update = vi.fn(sdkResult({ ok: true }));
  const slot = renderSlot(
    { component: StoreHarness },
    { children: <Probe collected={collected} />, store },
    {
      sidebarThreads: {
        threads: [],
        projects: [makePluginProject()],
        sections: [makeSection("sec_a", "Alpha"), makeSection("sec_b", "Beta")],
      },
      sdk: { threads: { unpin, update } },
      rpc: {
        listPreferences: () => ({
          preferences: {
            organizationMode,
            manualSectionOrder: [
              "pinned",
              "threads",
              "section:sec_b",
              "section:sec_a",
            ],
          },
        }),
      },
    },
  );
  const item = (thread: PluginThreadActionTarget) => {
    if (collected.current === null) throw new Error("Probe did not render");
    return collected.current.item(thread);
  };
  return {
    item,
    sdkCalls: slot.inspection.sdkCalls,
    hydrated: () =>
      waitFor(() =>
        expect(store.get(preferenceValueAtom("organizationMode"))).toBe(
          organizationMode,
        ),
      ),
  };
}

function run(action: PluginThreadAction | null, value: string) {
  if (action === null) throw new Error("Move is hidden");
  return action.run({ value, requestRename: () => {} });
}

describe("Move to section", () => {
  it("offers the sections in the list's order and marks the current one", async () => {
    const { item, hydrated } = renderMove();
    await hydrated();
    await waitFor(() =>
      expect(item(makeTarget())?.choices?.items).toEqual([
        { id: "threads", label: "Threads", selected: false, disabled: false },
        { id: "sec_b", label: "Beta", selected: false, disabled: false },
        { id: "sec_a", label: "Alpha", selected: true, disabled: true },
      ]),
    );
  });

  it.each([
    ["a child thread", makeTarget({ parentThreadId: "thr_parent" })],
    ["an archived thread", makeTarget({ archivedAt: 5 })],
  ])("is hidden for %s", async (_label, thread) => {
    const { item, hydrated } = renderMove();
    await hydrated();
    expect(item(thread)).toBeNull();
  });

  it("is hidden when the list is not organized chronologically", async () => {
    const { item, hydrated } = renderMove("project");
    await hydrated();
    await waitFor(() => expect(item(makeTarget())).toBeNull());
  });

  it("moves an unpinned thread with one update", async () => {
    const { item, sdkCalls, hydrated } = renderMove();
    await hydrated();
    run(item(makeTarget()), "sec_b");
    await waitFor(() =>
      expect(sdkCalls).toEqual([
        {
          method: "threads.update",
          args: [{ threadId: "thr_move", sectionId: "sec_b" }],
        },
      ]),
    );
  });

  it("unpins a pinned thread before moving it, and only unpins for its own section", async () => {
    const { item, sdkCalls, hydrated } = renderMove();
    await hydrated();
    const pinned = makeTarget({ pinnedAt: 2 });
    run(item(pinned), "threads");
    await waitFor(() =>
      expect(sdkCalls).toEqual([
        { method: "threads.unpin", args: [{ threadId: "thr_move" }] },
        {
          method: "threads.update",
          args: [{ threadId: "thr_move", sectionId: null }],
        },
      ]),
    );
    sdkCalls.length = 0;
    run(item(pinned), "sec_a");
    await waitFor(() =>
      expect(sdkCalls).toEqual([
        { method: "threads.unpin", args: [{ threadId: "thr_move" }] },
      ]),
    );
  });
});
