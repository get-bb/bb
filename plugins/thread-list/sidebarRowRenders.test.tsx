// @vitest-environment jsdom

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makePluginProject, makeSidebarThread } from "./app/model/fixtures.js";
import {
  resetPreferencesSyncForTest,
  setPreferencesMirrorStorageForTest,
} from "./app/preferences/preferences-sync.js";
import {
  defaultPreferences,
  type OrganizationMode,
} from "./shared/preferences.js";

const rowCommits = vi.hoisted(() => new Map<string, number>());

vi.mock("./app/rows/ThreadRow.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./app/rows/ThreadRow.js")>();
  const { Profiler, createElement, memo } = await import("react");
  const Row = actual.ThreadRow;
  return {
    ...actual,
    ThreadRow: memo(function CountedThreadRow(
      props: Parameters<typeof Row>[0],
    ) {
      return createElement(
        Profiler,
        {
          id: props.thread.id,
          onRender: (id: string) =>
            rowCommits.set(id, (rowCommits.get(id) ?? 0) + 1),
        },
        createElement(Row, props),
      );
    }),
  };
});

const app = await loadPluginApp(() => import("./app"));
const registration = app.threadLists[0];
if (!registration) throw new Error("thread-list slot not registered");

const PERSONAL_PROJECT_ID = "proj_personal";

const THREADS = [
  makeSidebarThread({
    id: "thr_pinned_a",
    projectId: PERSONAL_PROJECT_ID,
    title: "Pinned A",
    isPinned: true,
    pinnedAt: 20,
    pinSortKey: "a",
  }),
  makeSidebarThread({
    id: "thr_pinned_b",
    projectId: PERSONAL_PROJECT_ID,
    title: "Pinned B",
    isPinned: true,
    pinnedAt: 19,
    pinSortKey: "b",
  }),
  ...["a", "b", "c", "d", "e"].map((suffix, index) =>
    makeSidebarThread({
      id: `thr_${suffix}`,
      projectId: PERSONAL_PROJECT_ID,
      title: `Thread ${suffix}`,
      createdAt: 10 - index,
      updatedAt: 10 - index,
      latestAttentionAt: 10 - index,
    }),
  ),
];

const onNavigate = (): void => undefined;

function props(activeThreadId: string): PluginThreadListProps {
  return {
    activeThreadId,
    activeProjectId: PERSONAL_PROJECT_ID,
    isCompactViewport: false,
    onNavigate,
    searchQuery: "",
  };
}

afterEach(() => {
  cleanup();
  rowCommits.clear();
  resetPreferencesSyncForTest();
  setPreferencesMirrorStorageForTest(undefined);
});

describe.each<OrganizationMode>(["chronological", "project"])(
  "selecting a thread in %s mode",
  (organizationMode) => {
    it("redraws only the previously and newly selected rows", async () => {
      setPreferencesMirrorStorageForTest(null);
      const slot = renderSlot(registration, props("thr_a"), {
        sidebarThreads: {
          projects: [
            makePluginProject({
              id: PERSONAL_PROJECT_ID,
              name: "Personal",
              isPersonal: true,
            }),
          ],
          sections: [],
          threads: THREADS,
        },
        rpc: {
          listPreferences: () => ({
            preferences: { ...defaultPreferences(), organizationMode },
          }),
          setPreference: (input: unknown) => input,
        },
      });
      await screen.findByText("Thread e");
      await act(async () => undefined);
      const Component = registration.component;

      for (const [from, to] of [
        ["thr_a", "thr_c"],
        ["thr_c", "thr_pinned_b"],
        ["thr_pinned_b", "thr_pinned_a"],
      ]) {
        rowCommits.clear();
        act(() => slot.lifecycle.rerender(<Component {...props(to)} />));
        expect([...rowCommits.keys()].sort()).toEqual([from, to].sort());
      }
    });
  },
);
