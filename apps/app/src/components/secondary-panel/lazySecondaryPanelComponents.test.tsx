// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import {
  LazyBrowserTabDeck,
  LazyThreadSecondaryPanel,
} from "./lazySecondaryPanelComponents";

vi.mock("./ThreadSecondaryPanel", () => new Promise(() => {}));
vi.mock("./BrowserTabDeck", () => {
  throw new Error("chunk request failed");
});

afterEach(cleanup);

const noop = () => {};

function renderLoadingPanel({
  isConversationCollapsed = false,
  isOpen = true,
}: {
  isConversationCollapsed?: boolean;
  isOpen?: boolean;
} = {}) {
  return render(
    <PanelGroup direction="horizontal">
      <LazyThreadSecondaryPanel
        activeTab={null}
        canUseGitUi={false}
        drawerFallback={null}
        fixedTabs={[]}
        isConversationCollapsed={isConversationCollapsed}
        isOpen={isOpen}
        metadataContent={null}
        onClose={noop}
        onCollapse={noop}
        onOpenNewTab={noop}
        onPanelFocus={noop}
        onTabReorder={noop}
        onToggleConversationCollapse={noop}
        renderAsDrawer={false}
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
