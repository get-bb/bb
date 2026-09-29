// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import {
  LazyBrowserTabDeck,
  LazyThreadSecondaryPanel,
} from "./lazySecondaryPanelComponents";

const imports = vi.hoisted(() => ({ panel: vi.fn(), browser: vi.fn() }));
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

it("loads only the requested surface and retains a realized panel across closing", async () => {
  const view = render(<Surface open={false} browser={false} />);
  await act(async () => {});
  expect(imports.panel).not.toHaveBeenCalled();
  expect(imports.browser).not.toHaveBeenCalled();

  view.rerender(<Surface open browser={false} />);
  const input = await screen.findByRole("textbox", { name: "Panel draft" });
  fireEvent.change(input, { target: { value: "unsaved" } });
  expect(imports.panel).toHaveBeenCalledOnce();
  expect(imports.browser).not.toHaveBeenCalled();

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
