// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePluginDetailTabOpener } from "./plugin-detail-navigation";
import { openPluginDetailsInWorkspace } from "./plugin-detail-opener";
import { resetRecentlyClosedPanelTabsForTest } from "@/components/secondary-panel/recentlyClosedPanelTabs";
import { useThreadFileTabs } from "@/components/secondary-panel/useThreadFileTabs";
import { resetFixedPanelTabsStateForTest } from "@/lib/fixed-panel-tabs";

vi.mock("@/views/ToolsViewSplits", () => ({
  LazyPluginDetailPaneView: () => null,
}));

function Workspace({ id, focused }: { id: string; focused: boolean }) {
  const tabs = useThreadFileTabs({
    panelStateId: id,
    syncThreadId: null,
    environmentId: null,
    storageFiles: undefined,
    terminalSessions: undefined,
  });
  usePluginDetailTabOpener(tabs.openPluginDetail, focused);
  return (
    <section data-testid={id}>
      <ol>
        {tabs.orderedSecondaryFileTabs.map((tab) => (
          <li key={tab.id}>
            {tab.kind === "plugin-detail" ? tab.title : tab.kind}
            <button onClick={() => tabs.closeTab(tab.id)}>
              Close {tab.kind === "plugin-detail" ? tab.title : tab.kind}
            </button>
          </li>
        ))}
      </ol>
      <button onClick={() => tabs.reopenClosedTab()}>Reopen</button>
    </section>
  );
}

function tabTitles(id: string): string[] {
  return [...screen.getByTestId(id).querySelectorAll("li")].map(
    (item) => item.firstChild?.textContent ?? "",
  );
}

function renderWithQueries(ui: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  resetRecentlyClosedPanelTabsForTest();
  resetFixedPanelTabsStateForTest();
  window.localStorage.clear();
});

describe("plugin detail tabs", () => {
  it("opens one tab per plugin in the focused pane's panel, which owns them like any other tab", () => {
    const view = renderWithQueries(
      <>
        <Workspace id="left" focused />
        <Workspace id="right" focused={false} />
      </>,
    );
    act(() => {
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" });
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" });
      openPluginDetailsInWorkspace({ pluginId: "tasks", title: "Tasks" });
    });
    expect(tabTitles("left")).toEqual(["Docs", "Tasks"]);
    expect(tabTitles("right")).toEqual([]);

    act(() => screen.getByRole("button", { name: "Close Docs" }).click());
    expect(tabTitles("left")).toEqual(["Tasks"]);
    act(() => screen.getAllByRole("button", { name: "Reopen" })[0]?.click());
    expect(tabTitles("left")).toEqual(["Docs", "Tasks"]);

    view.unmount();
    expect(
      openPluginDetailsInWorkspace({ pluginId: "docs", title: "Docs" }),
    ).toBe(false);
  });
});
