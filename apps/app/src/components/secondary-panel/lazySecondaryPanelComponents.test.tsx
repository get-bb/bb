// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type {
  BrowserFixedPanelTab,
  SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import {
  LazyBrowserTabDeck,
  LazyThreadSecondaryPanel,
  ThreadSecondaryPanelDrawerPlaceholder,
} from "./lazySecondaryPanelComponents";

vi.mock("./ThreadSecondaryPanel", () => new Promise(() => {}));
vi.mock("./BrowserTabDeck", () => {
  throw new Error("chunk request failed");
});

afterEach(cleanup);

const noop = () => {};

function renderLoadingPanel({
  activeTab = null,
  isConversationCollapsed = false,
  isOpen = true,
  metadataContent = null,
  renderAsDrawer = false,
}: {
  activeTab?: SecondaryFixedPanelTab | null;
  metadataContent?: ReactNode;
  isConversationCollapsed?: boolean;
  isOpen?: boolean;
  renderAsDrawer?: boolean;
} = {}) {
  return render(
    <PanelGroup direction="horizontal">
      <LazyThreadSecondaryPanel
        drawerFallback={
          <ThreadSecondaryPanelDrawerPlaceholder
            activeTab={activeTab}
            metadataContent={metadataContent}
          />
        }
        activeTab={activeTab}
        fixedTabs={[]}
        isConversationCollapsed={isConversationCollapsed}
        isOpen={isOpen}
        metadataContent={metadataContent}
        onClose={noop}
        onCollapse={noop}
        onOpenNewTab={noop}
        onPanelFocus={noop}
        onTabReorder={noop}
        onToggleConversationCollapse={noop}
        renderAsDrawer={renderAsDrawer}
        tabs={[]}
      />
    </PanelGroup>,
  );
}

describe("LazyThreadSecondaryPanel", () => {
  it("keeps the panel seam visible while inline content loads", () => {
    renderLoadingPanel();

    const placeholder = screen.getByTestId(
      "thread-secondary-panel-placeholder",
    );
    expect(placeholder.className).toContain("border-l");
    expect(placeholder.className).toContain("border-border-seam");
  });

  it("does not show the loading seam when the panel is closed or full screen", () => {
    const view = renderLoadingPanel({ isOpen: false });

    expect(
      screen.getByTestId("thread-secondary-panel-placeholder").className,
    ).not.toContain("border-l");

    view.unmount();
    renderLoadingPanel({ isConversationCollapsed: true });

    expect(
      screen.getByTestId("thread-secondary-panel-placeholder").className,
    ).not.toContain("border-l");
  });
});

describe("LazyThreadSecondaryPanel drawer", () => {
  it("shows the active file's loading preview under the panel chrome while the panel loads", () => {
    renderLoadingPanel({
      renderAsDrawer: true,
      activeTab: {
        environmentId: "env-1",
        id: "tab-file",
        kind: "workspace-file-preview",
        lineRange: null,
        path: "notes/open-prs.md",
        projectId: "project-1",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });

    const placeholder = screen.getByTestId(
      "thread-secondary-panel-drawer-placeholder",
    );
    expect(
      within(placeholder).getByRole("status", {
        name: "Loading file preview",
      }),
    ).not.toBeNull();
    expect(placeholder.textContent).toContain("notes/open-prs.md");
  });
});

describe("LazyThreadSecondaryPanel thread info placeholder", () => {
  it.each([false, true])(
    "shows thread details for the core info tab (drawer: %s)",
    (renderAsDrawer) => {
      renderLoadingPanel({
        renderAsDrawer,
        activeTab: {
          id: "plugin-fixed:core:info",
          kind: "plugin-fixed",
          pluginId: "core",
          tabId: "info",
        },
        metadataContent: <p>Thread details</p>,
      });

      expect(screen.getByText("Thread details")).not.toBeNull();
      expect(
        screen.queryByTestId("secondary-panel-content-skeleton"),
      ).toBeNull();
    },
  );
});

describe("LazyBrowserTabDeck", () => {
  const browserTab: BrowserFixedPanelTab = {
    environmentId: "env-1",
    id: "tab-a",
    kind: "browser",
    title: null,
    url: "https://example.com",
  };

  function renderDeck(activeBrowserTabId: string | null) {
    return (
      <LazyBrowserTabDeck
        activeBrowserTabId={activeBrowserTabId}
        browserTabs={[browserTab]}
        canShowNativeBrowserView={false}
        environmentId="env-1"
        onUpdate={noop}
        onOpenInNewTab={null}
        threadId="thread-1"
      />
    );
  }

  it("reports a failed download only while a browser tab is showing", async () => {
    const view = render(renderDeck(browserTab.id));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load.",
    );

    view.rerender(renderDeck(null));
    expect(screen.queryByRole("alert")).toBeNull();

    view.rerender(renderDeck(browserTab.id));
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
