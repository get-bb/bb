// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import {
  makePluginProject,
  makeSidebarThread,
  sdkResult,
} from "../model/fixtures.js";
import {
  preferenceValueAtom,
  resetPreferencesSyncForTest,
} from "../preferences/preferences-sync.js";

installTestPluginRuntime();
const { ThreadSelectionContextMenu } =
  await import("./ThreadSelectionContextMenu.js");

afterEach(() => {
  cleanup();
  resetPreferencesSyncForTest();
});

it("moves selected roots while preserving descendants and detaching independently selected children", async () => {
  const store = createStore();
  const update = vi.fn(sdkResult({ ok: true }));
  const unpin = vi.fn(sdkResult({ ok: true }));
  const threads = [
    makeSidebarThread({ id: "parent" }),
    makeSidebarThread({ id: "child", parentThreadId: "parent" }),
    makeSidebarThread({ id: "middle", parentThreadId: "parent" }),
    makeSidebarThread({ id: "grandchild", parentThreadId: "middle" }),
    makeSidebarThread({ id: "other-parent" }),
    makeSidebarThread({
      id: "independent",
      parentThreadId: "other-parent",
      pinnedAt: 1,
    }),
  ];
  function Harness() {
    return (
      <Provider store={store}>
        <ThreadSelectionContextMenu
          threadIds={["parent", "child", "grandchild", "independent"]}
          disabled={false}
          onOpenChange={() => {}}
        >
          <button>Selected threads</button>
        </ThreadSelectionContextMenu>
      </Provider>
    );
  }
  renderSlot(
    { component: Harness },
    {},
    {
      sidebarThreads: {
        threads,
        projects: [makePluginProject()],
        sections: [
          {
            id: "destination",
            name: "Destination",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      sdk: { threads: { update, unpin } },
      rpc: {
        listPreferences: () => ({
          preferences: { organizationMode: "chronological" },
        }),
      },
    },
  );
  fireEvent.contextMenu(
    screen.getByRole("button", { name: "Selected threads" }),
  );
  await waitFor(() =>
    expect(store.get(preferenceValueAtom("organizationMode"))).toBe(
      "chronological",
    ),
  );
  const move = await screen.findByRole("menuitem", { name: "Move to section" });
  fireEvent.keyDown(move, { key: "ArrowRight" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Destination" }));
  await waitFor(() =>
    expect(update.mock.calls).toEqual([
      [{ threadId: "parent", sectionId: "destination" }],
      [
        {
          threadId: "independent",
          sectionId: "destination",
          parentThreadId: null,
        },
      ],
    ]),
  );
  expect(unpin.mock.calls).toEqual([[{ threadId: "independent" }]]);
});

it("clears the multi-selection when Escape dismisses its context menu", async () => {
  const {
    ThreadSelectionProvider,
    useThreadSelectionStore,
    useMultiSelectionContaining,
  } = await import("./threadSelection.js");
  function Selection() {
    const store = useThreadSelectionStore();
    const selected = useMultiSelectionContaining("a");
    return (
      <div data-sidebar="content">
        <a href="#a" data-sidebar-thread-id="a">
          First
        </a>
        <ThreadSelectionContextMenu
          threadIds={selected}
          disabled={selected === null}
          onOpenChange={() => {}}
        >
          <a
            data-sidebar-thread-id="b"
            onClick={(event) =>
              store.handleClick("b", event, event.currentTarget)
            }
          >
            Second
          </a>
        </ThreadSelectionContextMenu>
        <output>{selected?.length ?? 0} selected</output>
      </div>
    );
  }
  function Harness() {
    return (
      <ThreadSelectionProvider activeThreadId="a">
        <Selection />
      </ThreadSelectionProvider>
    );
  }
  renderSlot(
    { component: Harness },
    {},
    { experiments: ["sidebarMultiSelect"] },
  );
  fireEvent.click(screen.getByText("Second"), {
    metaKey: true,
    shiftKey: true,
  });
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.contextMenu(screen.getByText("Second"));
  const menu = await screen.findByRole("menu", {
    name: "Actions for 2 threads",
  });
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(screen.getByText("0 selected")).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByText("First")),
  );
});
