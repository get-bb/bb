// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, expect, it, vi } from "vitest";
import { SecondaryPanelTabStrip } from "./SecondaryPanelTabStrip";
import { SidebarSplitContainer } from "./SidebarSplitContainer";

const descriptors = ["alpha.ts", "beta.ts"].map((label) => ({
  id: label,
  label,
  restoresPlacementAfterRemoval: true,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementsFromPoint");
});

function renderTabs() {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const onReorder = vi.fn();

  render(
    <TooltipProvider>
      <aside>
        <SidebarSplitContainer
          activeTabId="alpha.ts"
          isFullScreen={false}
          onActivateTab={() => {}}
          onGlobalTabReorder={onReorder}
          onToggleFullScreen={() => {}}
          panelStateId="tab-gestures"
          tabs={descriptors}
          renderPane={({ group, onBeginTabDrag, onReorderTab }) => (
            <div data-testid="thread-secondary-panel-top-chrome">
              <SecondaryPanelTabStrip
                activeTabId={group.activeTabId}
                tabs={group.tabIds.map((id) => ({
                  label: id,
                  leadingVisual: null,
                  statusLabel: null,
                  onClose: () => onClose(id),
                  onSelect: () => onSelect(id),
                  renderContent: () => null,
                  tab: {
                    id,
                    kind: "host-file-preview" as const,
                    environmentId: null,
                    hostId: null,
                    lineRange: null,
                    path: id,
                    threadId: null,
                  },
                }))}
                onBeginTabDrag={onBeginTabDrag}
                onReorderTab={onReorderTab}
                usesDesktopChrome={false}
                isPanelOpen
              />
            </div>
          )}
        />
      </aside>
    </TooltipProvider>,
  );
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const isChrome =
        this.dataset.testid === "thread-secondary-panel-top-chrome";
      return new DOMRect(0, 0, 600, isChrome ? 40 : 400);
    },
  );
  return { onClose, onSelect, onReorder };
}

function pressAndRelease(target: HTMLElement, deltaY: number) {
  const start = { button: 0, clientX: 100, clientY: 20 };
  const end = { clientX: 100, clientY: 20 + deltaY };
  fireEvent(target, new MouseEvent("pointerdown", { bubbles: true, ...start }));
  fireEvent.mouseDown(target, start);
  fireEvent(window, new MouseEvent("pointermove", end));
  fireEvent.mouseMove(document, end);
  fireEvent(window, new MouseEvent("pointerup"));
  fireEvent.mouseUp(document);
  fireEvent.click(target);
}

it.each([5, 8])(
  "selects a tab clicked with %spx of jitter without reordering or splitting",
  (deltaY) => {
    const { onSelect, onReorder } = renderTabs();
    pressAndRelease(screen.getByRole("button", { name: "beta.ts" }), deltaY);
    expect(onSelect).toHaveBeenCalledWith("beta.ts");
    expect(onReorder).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
  },
);

it("closes a tab whose close press moves vertically without splitting", () => {
  const { onClose } = renderTabs();
  pressAndRelease(screen.getByRole("button", { name: "Close beta.ts" }), 16);
  expect(onClose).toHaveBeenCalledWith("beta.ts");
  expect(screen.queryAllByRole("separator")).toHaveLength(0);
});

it("splits a tab dragged 16px vertically", () => {
  const { onSelect, onClose } = renderTabs();
  pressAndRelease(screen.getByRole("button", { name: "beta.ts" }), 16);
  expect(screen.getAllByRole("separator")).toHaveLength(1);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
