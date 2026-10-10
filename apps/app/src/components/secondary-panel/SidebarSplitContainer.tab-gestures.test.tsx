// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SecondaryPanelTabStrip } from "./SecondaryPanelTabStrip";
import { SidebarSplitContainer } from "./SidebarSplitContainer";

const descriptors = [
  { id: "tab-a", label: "alpha.ts", restoresPlacementAfterRemoval: true },
  { id: "tab-b", label: "beta.ts", restoresPlacementAfterRemoval: true },
];
const originalHitTest = Object.getOwnPropertyDescriptor(
  document,
  "elementsFromPoint",
);

afterEach(() => {
  fireEvent(window, new MouseEvent("pointercancel"));
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  if (originalHitTest) {
    Object.defineProperty(document, "elementsFromPoint", originalHitTest);
  } else {
    Reflect.deleteProperty(document, "elementsFromPoint");
  }
});

function renderTabs() {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const onReorder = vi.fn();

  function Harness() {
    const [activeTabId, setActiveTabId] = useState("tab-a");
    return (
      <SidebarProvider>
        <TooltipProvider>
          <aside>
            <SidebarSplitContainer
              activeTabId={activeTabId}
              isFullScreen={false}
              onActivateTab={setActiveTabId}
              onGlobalTabReorder={onReorder}
              onToggleFullScreen={() => {}}
              panelStateId="tab-gesture-regression"
              tabs={descriptors}
              renderPane={({
                group,
                onBeginTabDrag,
                onReorderTab,
                onSelectTab,
              }) => (
                <section>
                  <div data-testid="thread-secondary-panel-top-chrome">
                    <SecondaryPanelTabStrip
                      activeTabId={group.activeTabId}
                      tabs={descriptors
                        .filter((tab) => group.tabIds.includes(tab.id))
                        .map((tab) => ({
                          label: tab.label,
                          leadingVisual: null,
                          statusLabel: null,
                          onClose: () => onClose(tab.id),
                          onSelect: () => {
                            onSelect(tab.id);
                            onSelectTab(tab.id);
                          },
                          renderContent: () => null,
                          tab: {
                            id: tab.id,
                            kind: "host-file-preview" as const,
                            environmentId: null,
                            hostId: null,
                            lineRange: null,
                            path: tab.label,
                            threadId: null,
                          },
                        }))}
                      onBeginTabDrag={onBeginTabDrag}
                      onReorderTab={onReorderTab}
                      usesDesktopChrome={false}
                      isPanelOpen
                    />
                  </div>
                  <p>{group.activeTabId}</p>
                </section>
              )}
            />
          </aside>
        </TooltipProvider>
      </SidebarProvider>
    );
  }

  render(<Harness />);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(
        0,
        0,
        600,
        this.dataset.testid === "thread-secondary-panel-top-chrome" ? 40 : 400,
      );
    },
  );
  return { onClose, onSelect, onReorder };
}

function gesture(target: HTMLElement, deltaY: number) {
  fireEvent(
    target,
    new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 20,
    }),
  );
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 20 });
  fireEvent(
    window,
    new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 20 + deltaY,
    }),
  );
  fireEvent.mouseMove(document, { clientX: 100, clientY: 20 + deltaY });
  fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
  fireEvent.mouseUp(document);
  fireEvent.click(target);
}

it.each([5, 8])(
  "selects a tab instead of splitting or suppressing the click after %spx of jitter",
  (distance) => {
    const { onSelect, onReorder } = renderTabs();
    gesture(
      screen.getByRole("button", { name: "beta.ts" }),
      distance,
    );
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(onSelect).toHaveBeenCalledWith("tab-b");
    expect(onReorder).not.toHaveBeenCalled();
  },
);

it("closes a tab instead of splitting when the close press moves vertically", () => {
  const { onClose } = renderTabs();
  gesture(screen.getByRole("button", { name: "Close beta.ts" }), 16);
  expect(screen.queryAllByRole("separator")).toHaveLength(0);
  expect(onClose).toHaveBeenCalledWith("tab-b");
});

it("still splits a tab after an intentional vertical drag", () => {
  const { onSelect, onClose } = renderTabs();
  gesture(screen.getByRole("button", { name: "beta.ts" }), 16);
  expect(screen.getAllByRole("separator")).toHaveLength(1);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
