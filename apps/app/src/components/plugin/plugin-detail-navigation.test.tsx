// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { arrayMove } from "@bb/client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadSecondaryPanelProps } from "@/components/secondary-panel/ThreadSecondaryPanel";
import {
  PluginDetailPanelContext,
  usePluginDetailPanelProps,
  usePluginDetailPanelState,
} from "./plugin-detail-navigation";
import { openPluginDetailsInWorkspace } from "./plugin-detail-opener";

const selectExisting = vi.fn();
const closePanel = vi.fn();
const existingTab = { id: "new-tab:existing", kind: "new-tab" as const };
const baseProps: ThreadSecondaryPanelProps = {
  activeTab: existingTab,
  canUseGitUi: false,
  metadataContent: null,
  tabs: [
    {
      tab: existingTab,
      label: "Existing tab",
      leadingVisual: null,
      statusLabel: null,
      renderContent: () => null,
      onClose: vi.fn(),
      onSelect: selectExisting,
    },
  ],
  fixedTabs: [],
  isOpen: false,
  onTabReorder: vi.fn(),
  onPanelFocus: vi.fn(),
  onClose: closePanel,
  onCollapse: closePanel,
  onOpenNewTab: vi.fn(),
  isConversationCollapsed: false,
  onToggleConversationCollapse: vi.fn(),
  renderAsDrawer: false,
};

function PanelProbe({
  id,
  input = baseProps,
}: {
  id: string;
  input?: ThreadSecondaryPanelProps;
}) {
  const props = usePluginDetailPanelProps(input);
  return (
    <div
      data-testid={id}
      data-active={props.activeTab?.id}
      data-open={props.isOpen}
    >
      {props.tabs.map((tab, index) => (
        <div key={tab.tab.id}>
          <button onClick={tab.onSelect}>{tab.label}</button>
          <button onClick={tab.onClose}>Close {tab.label}</button>
          <button
            onClick={() =>
              props.onTabReorder({
                activeTabId: tab.tab.id,
                overTabId: props.tabs[Math.max(0, index - 1)].tab.id,
              })
            }
          >
            Move {tab.label} left
          </button>
          <button
            onClick={() =>
              props.onTabReorder({
                activeTabId: tab.tab.id,
                overTabId: props.tabs[0].tab.id,
              })
            }
          >
            Move {tab.label} first
          </button>
        </div>
      ))}
      <button onClick={props.onClose}>Hide panel</button>
    </div>
  );
}

function ReorderingWorkspace() {
  const state = usePluginDetailPanelState("reordering", true);
  const [tabs, setTabs] = useState([
    baseProps.tabs[0],
    {
      ...baseProps.tabs[0],
      label: "Another tab",
      tab: { id: "new-tab:another", kind: "new-tab" as const },
    },
  ]);
  return (
    <PluginDetailPanelContext.Provider value={state}>
      <PanelProbe
        id="reordering"
        input={{
          ...baseProps,
          tabs,
          onTabReorder: ({ activeTabId, overTabId }) => {
            const from = tabs.findIndex((tab) => tab.tab.id === activeTabId);
            const to = tabs.findIndex((tab) => tab.tab.id === overTabId);
            if (from !== -1 && to !== -1) setTabs(arrayMove(tabs, from, to));
          },
        }}
      />
    </PluginDetailPanelContext.Provider>
  );
}

function Workspace({
  id,
  focused,
  revision = id,
}: {
  id: string;
  focused: boolean;
  revision?: string;
}) {
  const state = usePluginDetailPanelState(revision, focused);
  return (
    <PluginDetailPanelContext.Provider value={state}>
      <PanelProbe id={id} />
    </PluginDetailPanelContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("plugin details in the active workspace", () => {
  it("preserves ordinary tab order after dragging across details and closing them", () => {
    render(<ReorderingWorkspace />);
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" }),
    );
    act(() => screen.getByRole("button", { name: "Move Docs first" }).click());
    act(() =>
      screen.getByRole("button", { name: "Move Another tab first" }).click(),
    );
    expect(
      screen
        .getAllByRole("button", { name: /^Move .* left$/ })
        .map((button) => button.textContent),
    ).toEqual([
      "Move Another tab left",
      "Move Docs left",
      "Move Existing tab left",
    ]);
    act(() => screen.getByRole("button", { name: "Close Docs" }).click());
    expect(
      screen
        .getAllByRole("button", { name: /^Move .* left$/ })
        .map((button) => button.textContent),
    ).toEqual(["Move Another tab left", "Move Existing tab left"]);
  });

  it("retains detail-tab drag order among details and across existing tabs", () => {
    const view = render(<Workspace id="workspace" focused />);
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" }),
    );
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "tasks", title: "Tasks" }),
    );
    const order = () =>
      screen
        .getAllByRole("button", { name: /^Move .* left$/ })
        .map((button) => button.textContent);
    act(() => screen.getByRole("button", { name: "Move Tasks left" }).click());
    expect(order()).toEqual([
      "Move Existing tab left",
      "Move Tasks left",
      "Move Docs left",
    ]);
    act(() => screen.getByRole("button", { name: "Move Tasks left" }).click());
    expect(order()).toEqual([
      "Move Tasks left",
      "Move Existing tab left",
      "Move Docs left",
    ]);
    act(() => screen.getByRole("button", { name: "Docs" }).click());
    expect(order()).toEqual([
      "Move Tasks left",
      "Move Existing tab left",
      "Move Docs left",
    ]);
    act(() => screen.getByRole("button", { name: "Close Tasks" }).click());
    expect(order()).toEqual(["Move Existing tab left", "Move Docs left"]);
    view.rerender(
      <Workspace id="workspace" focused revision="another-workspace" />,
    );
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "tasks", title: "Tasks" }),
    );
    expect(order()).toEqual(["Move Existing tab left", "Move Tasks left"]);
  });

  it("opens and focuses a single detail tab without replacing existing tabs", () => {
    render(<Workspace id="workspace" focused />);
    act(() => {
      expect(
        openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" }),
      ).toBe(true);
    });
    expect(screen.getByTestId("workspace").dataset.active).toBe(
      "marketplace-plugin:docs",
    );
    expect(screen.getByTestId("workspace").dataset.open).toBe("true");
    act(() => screen.getByRole("button", { name: "Existing tab" }).click());
    expect(selectExisting).toHaveBeenCalledOnce();
    expect(screen.getByTestId("workspace").dataset.active).toBe(existingTab.id);
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" }),
    );
    expect(screen.getAllByRole("button", { name: "Docs" })).toHaveLength(1);
    act(() => screen.getByRole("button", { name: "Close Docs" }).click());
    expect(screen.getByTestId("workspace").dataset.active).toBe(existingTab.id);
    expect(screen.getByTestId("workspace").dataset.open).toBe("false");
  });

  it("targets only the focused pane and unregisters after it unmounts", () => {
    const view = render(
      <>
        <Workspace id="left" focused />
        <Workspace id="right" focused={false} />
      </>,
    );
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" }),
    );
    expect(screen.getByTestId("left").dataset.active).toBe(
      "marketplace-plugin:docs",
    );
    expect(screen.getByTestId("right").dataset.active).toBe(existingTab.id);
    view.rerender(
      <>
        <Workspace id="left" focused={false} />
        <Workspace id="right" focused />
      </>,
    );
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "tasks", title: "Tasks" }),
    );
    expect(screen.getByTestId("right").dataset.active).toBe(
      "marketplace-plugin:tasks",
    );
    view.unmount();
    expect(
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" }),
    ).toBe(false);
  });

  it("closes to the adjacent detail tab, then clears when the workspace changes", () => {
    const view = render(<Workspace id="workspace" focused />);
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" }),
    );
    act(() =>
      openPluginDetailsInWorkspace({ pluginId: "tasks", title: "Tasks" }),
    );
    act(() => screen.getByRole("button", { name: "Close Tasks" }).click());
    expect(screen.getByTestId("workspace").dataset.active).toBe(
      "marketplace-plugin:docs",
    );
    act(() => screen.getByRole("button", { name: "Hide panel" }).click());
    expect(closePanel).toHaveBeenCalledOnce();
    expect(screen.getByTestId("workspace").dataset.open).toBe("false");
    view.rerender(
      <Workspace id="workspace" focused revision="different-workspace" />,
    );
    expect(screen.queryByRole("button", { name: "Docs" })).toBeNull();
  });
});
