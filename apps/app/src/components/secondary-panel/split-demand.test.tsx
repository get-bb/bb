// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSplitPreload } from "@/lib/define-split";
import { PanelGroup } from "react-resizable-panels";
import {
  LazyBrowserTabDeck,
  LazyThreadSecondaryPanel,
} from "./lazySecondaryPanelComponents";

const imports = vi.hoisted(() => ({
  panel: vi.fn(),
  browser: vi.fn(),
  terminal: vi.fn(),
  newTab: vi.fn(),
  preview: vi.fn(),
  tabs: vi.fn(),
}));
vi.mock("@/components/thread/terminal/ThreadTerminalPanel", () => {
  imports.terminal();
  return { ThreadTerminalPanel: () => <p>Terminal mounted</p> };
});
vi.mock("./NewTabPage", () => {
  imports.newTab();
  return { NewTabPage: () => <p>New tab mounted</p> };
});
vi.mock("./FilePreview", () => {
  imports.preview();
  return { FilePreview: () => <p>Preview mounted</p> };
});
vi.mock("./ThreadSecondaryPanelTabContent", () => {
  imports.tabs();
  return {
    WorkspaceFilePreviewTabContent: () => null,
    HostFilePreviewTabContent: () => null,
    HostScopedFilePreviewTabContent: () => null,
    ProjectFilePreviewTabContent: () => null,
    ThreadStorageFilePreviewTabContent: () => null,
  };
});
vi.mock("./ThreadSecondaryPanel", () => {
  imports.panel();
  return { ThreadSecondaryPanel: () => <input aria-label="Panel draft" /> };
});
vi.mock("./BrowserTabDeck", () => {
  imports.browser();
  return { BrowserTabDeck: () => <p>Browser loaded</p> };
});
afterEach(cleanup);
const noop = () => {};

function Surface({ open, browser }: { open: boolean; browser: boolean }) {
  useSplitPreload(LazyThreadSecondaryPanel);
  return (
    <PanelGroup direction="horizontal">
      <LazyThreadSecondaryPanel
        activeTab={null}
        canUseGitUi={false}
        drawerFallback={null}
        fixedTabs={[]}
        isConversationCollapsed={false}
        isOpen={open}
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
      <LazyBrowserTabDeck
        activeBrowserTabId={browser ? "browser-tab" : null}
        browserTabs={[
          {
            id: "browser-tab",
            kind: "browser",
            environmentId: "env",
            title: null,
            url: "https://example.com",
          },
        ]}
        canShowNativeBrowserView={false}
        environmentId="env"
        onUpdate={noop}
        threadId="thread"
      />
    </PanelGroup>
  );
}

it("warms the shell on page mount and tab code on first open without mounting hidden content", async () => {
  const view = render(<Surface open={false} browser={false} />);
  await act(async () => {});
  await waitFor(() => expect(imports.panel).toHaveBeenCalledOnce());
  expect(screen.queryByRole("textbox", { name: "Panel draft" })).toBeNull();
  expect(imports.browser).not.toHaveBeenCalled();

  view.rerender(<Surface open browser={false} />);
  const input = await screen.findByRole("textbox", { name: "Panel draft" });
  fireEvent.change(input, { target: { value: "unsaved" } });
  expect(imports.panel).toHaveBeenCalledOnce();
  await waitFor(() => {
    for (const load of Object.values(imports))
      expect(load).toHaveBeenCalledOnce();
  });
  expect(screen.queryByText("Browser loaded")).toBeNull();
  expect(screen.queryByText("Terminal mounted")).toBeNull();
  expect(screen.queryByText("New tab mounted")).toBeNull();
  expect(screen.queryByText("Preview mounted")).toBeNull();

  view.rerender(<Surface open browser />);
  expect(await screen.findByText("Browser loaded")).toBeTruthy();
  view.rerender(<Surface open={false} browser={false} />);
  view.rerender(<Surface open browser />);
  expect(screen.getByRole("textbox", { name: "Panel draft" })).toHaveProperty(
    "value",
    "unsaved",
  );
  expect(imports.panel).toHaveBeenCalledOnce();
  expect(imports.browser).toHaveBeenCalledOnce();
});
