// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  SidebarSplitContainer,
  type SidebarSplitHeaderRenderArgs,
  type SidebarSplitPaneRenderArgs,
  type SidebarSplitTabDescriptor,
} from "./SidebarSplitContainer";
import {
  createSidebarSplitState,
  focusSidebarPane,
  moveSidebarTab,
  serializeSidebarSplitState,
  sidebarSplitStorageKey,
  type SidebarSplitState,
} from "./sidebarSplitLayout";
import { getFixedPanelTabsStateStorageKey } from "@/lib/fixed-panel-tabs-state";

const TABS: readonly SidebarSplitTabDescriptor[] = [
  { id: "tab-a", label: "A", leadingVisual: null },
  { id: "tab-b", label: "B", leadingVisual: null },
];
const PANEL_STATE_ID = "sidebar-split-container-test";
let nextPaneInstance = 0;

function createTwoPaneState(): SidebarSplitState {
  const initial = createSidebarSplitState(
    TABS.map((tab) => tab.id),
    "tab-a",
  );
  return moveSidebarTab(
    initial,
    initial.layout.focusedPaneId,
    "tab-b",
    { paneId: initial.layout.focusedPaneId, zone: "right" },
    { groupId: "group-b" },
  );
}

function createStackedPaneState(): SidebarSplitState {
  const initial = createSidebarSplitState(
    TABS.map((tab) => tab.id),
    "tab-a",
  );
  return moveSidebarTab(
    initial,
    initial.layout.focusedPaneId,
    "tab-b",
    { paneId: initial.layout.focusedPaneId, zone: "bottom" },
    { groupId: "group-b" },
  );
}

function persistState(state: SidebarSplitState): void {
  window.localStorage.setItem(
    sidebarSplitStorageKey(PANEL_STATE_ID),
    serializeSidebarSplitState(state),
  );
}

function renderContainer({
  activeTabId = "tab-a",
  onActivateTab = vi.fn(),
  renderPane,
  renderSplitHeader,
  tabs = TABS,
}: {
  activeTabId?: string;
  onActivateTab?: (tabId: string) => void;
  renderPane: (args: SidebarSplitPaneRenderArgs) => ReactNode;
  renderSplitHeader?: (args: SidebarSplitHeaderRenderArgs) => ReactNode;
  tabs?: readonly SidebarSplitTabDescriptor[];
}) {
  return render(
    <SidebarProvider>
      <TooltipProvider>
        <SidebarSplitContainer
          activeTabId={activeTabId}
          onActivateTab={onActivateTab}
          onGlobalTabReorder={vi.fn()}
          panelStateId={PANEL_STATE_ID}
          renderPane={renderPane}
          renderSplitHeader={renderSplitHeader}
          tabs={tabs}
        />
      </TooltipProvider>
    </SidebarProvider>,
  );
}

function StatefulPane({
  onMoveActiveTabToSide,
  paneId,
}: {
  onMoveActiveTabToSide: NonNullable<
    SidebarSplitPaneRenderArgs["onMoveActiveTabToSide"]
  >;
  paneId: string;
}) {
  const [instanceId] = useState(() => `${paneId}-${nextPaneInstance++}`);
  return (
    <div data-testid={`pane-content-${paneId}`}>
      <span data-testid={`pane-instance-${paneId}`}>{instanceId}</span>
      <button type="button" onClick={() => onMoveActiveTabToSide("left")}>
        Move {paneId} left
      </button>
    </div>
  );
}

describe("SidebarSplitContainer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    nextPaneInstance = 0;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.style.userSelect = "";
  });

  it("activates a focused pane outside React's state updater", async () => {
    const split = createTwoPaneState();
    const firstPaneId =
      split.layout.root.type === "split"
        ? split.layout.root.children[0]?.type === "pane"
          ? split.layout.root.children[0].paneId
          : null
        : null;
    const secondPaneId =
      split.layout.root.type === "split"
        ? split.layout.root.children[1]?.type === "pane"
          ? split.layout.root.children[1].paneId
          : null
        : null;
    expect(firstPaneId).not.toBeNull();
    expect(secondPaneId).not.toBeNull();
    if (firstPaneId === null || secondPaneId === null) return;
    persistState(focusSidebarPane(split, firstPaneId));

    const activate = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    function Harness() {
      const [activeTabId, setActiveTabId] = useState("tab-a");
      return (
        <SidebarSplitContainer
          activeTabId={activeTabId}
          onActivateTab={(tabId) => {
            activate(tabId);
            setActiveTabId(tabId);
          }}
          onGlobalTabReorder={vi.fn()}
          panelStateId={PANEL_STATE_ID}
          renderPane={({ paneId }) => (
            <div data-testid={`pane-content-${paneId}`}>{paneId}</div>
          )}
          tabs={TABS}
        />
      );
    }

    render(
      <SidebarProvider>
        <TooltipProvider>
          <Harness />
        </TooltipProvider>
      </SidebarProvider>,
    );
    fireEvent.pointerDown(screen.getByTestId(`pane-content-${secondPaneId}`));

    await waitFor(() => expect(activate).toHaveBeenCalledWith("tab-b"));
    expect(activate).toHaveBeenCalledTimes(1);
    expect(
      consoleError.mock.calls.some((call) =>
        call.some(
          (value) =>
            typeof value === "string" &&
            value.includes("Cannot update a component while rendering"),
        ),
      ),
    ).toBe(false);
  });

  it("reports both panes as visible and assigns outer controls only once", () => {
    const split = createTwoPaneState();
    const focusedPaneId =
      split.layout.root.type === "split" &&
      split.layout.root.children[0]?.type === "pane"
        ? split.layout.root.children[0].paneId
        : split.layout.focusedPaneId;
    persistState(focusSidebarPane(split, focusedPaneId));

    renderContainer({
      renderPane: ({ isFocused, isVisible, paneId, showOuterControls }) => (
        <div data-testid={`pane-state-${paneId}`}>
          {`${isFocused}:${isVisible}:${showOuterControls}`}
        </div>
      ),
    });

    const paneStates = screen.getAllByTestId(/pane-state-/);
    expect(paneStates.map((pane) => pane.textContent)).toContain(
      "true:true:false",
    );
    expect(paneStates.map((pane) => pane.textContent)).toContain(
      "false:true:true",
    );
  });

  it.each([
    ["left", "flex-row", "tab-a,tab-b"],
    ["right", "flex-row", "tab-b,tab-a"],
    ["top", "flex-col", "tab-a,tab-b"],
    ["bottom", "flex-col", "tab-b,tab-a"],
  ] as const)(
    "moves the active tab to the supported %s position without dragging",
    (side, directionClass, expectedOrder) => {
      renderContainer({
        renderPane: ({ group, onMoveActiveTabToSide }) => (
          <button type="button" onClick={() => onMoveActiveTabToSide?.(side)}>
            Move active {side}
            <span data-testid="active-pane-tab">{group.activeTabId}</span>
          </button>
        ),
      });

      fireEvent.click(
        screen.getByRole("button", { name: `Move active ${side}tab-a` }),
      );

      const panes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-split-pane-id]"),
      );
      expect(panes).toHaveLength(2);
      expect(panes[0]?.parentElement?.parentElement?.className).toContain(
        directionClass,
      );
      expect(
        panes
          .map(
            (pane) =>
              pane.querySelector<HTMLElement>("[data-testid='active-pane-tab']")
                ?.textContent,
          )
          .join(","),
      ).toBe(expectedOrder);
    },
  );

  it("positions the focused active tab even when the control is in the outer pane", () => {
    const split = createTwoPaneState();
    const firstPane =
      split.layout.root.type === "split" &&
      split.layout.root.children[0]?.type === "pane"
        ? split.layout.root.children[0]
        : null;
    expect(firstPane).not.toBeNull();
    if (firstPane === null) return;
    persistState(focusSidebarPane(split, firstPane.paneId));

    renderContainer({
      renderPane: ({ group, onMoveActiveTabToSide, showOuterControls }) => (
        <div>
          <span data-testid="active-pane-tab">{group.activeTabId}</span>
          {showOuterControls ? (
            <button
              type="button"
              onClick={() => onMoveActiveTabToSide?.("bottom")}
            >
              Move focused bottom
            </button>
          ) : null}
        </div>
      ),
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Move focused bottom" }),
    );
    expect(
      screen
        .getAllByTestId("active-pane-tab")
        .map((tab) => tab.textContent)
        .join(","),
    ).toBe("tab-b,tab-a");
  });

  it("keeps stateful pane content attached to pane identity after a move", () => {
    const split = createTwoPaneState();
    persistState(split);

    renderContainer({
      renderPane: ({ onMoveActiveTabToSide, paneId }) =>
        onMoveActiveTabToSide ? (
          <StatefulPane
            onMoveActiveTabToSide={onMoveActiveTabToSide}
            paneId={paneId}
          />
        ) : null,
    });

    const paneIds = Array.from(
      document.querySelectorAll<HTMLElement>("[data-split-pane-id]"),
      (pane) => pane.dataset.splitPaneId,
    ).filter((paneId): paneId is string => paneId !== undefined);
    expect(paneIds).toHaveLength(2);
    const before = new Map(
      paneIds.map((paneId) => [
        paneId,
        screen.getByTestId(`pane-instance-${paneId}`).textContent,
      ]),
    );
    const paneToMove = paneIds[1];
    expect(paneToMove).toBeDefined();
    if (paneToMove === undefined) return;

    fireEvent.click(
      screen.getByRole("button", { name: `Move ${paneToMove} left` }),
    );

    for (const paneId of paneIds) {
      expect(screen.getByTestId(`pane-instance-${paneId}`).textContent).toBe(
        before.get(paneId) ?? "missing-instance",
      );
    }
  });

  it("keeps header slots synchronized with adjacent panes throughout resizing", () => {
    persistState(createTwoPaneState());
    renderContainer({
      renderPane: ({ group, paneId }) => (
        <div data-testid={`body-label-${paneId}`}>{group.activeTabId}</div>
      ),
      renderSplitHeader: ({ renderTabGroups }) => (
        <div data-testid="shared-split-header">
          {renderTabGroups(({ group, paneId }) => (
            <div
              className="min-w-0 overflow-hidden"
              data-testid={`header-label-${paneId}`}
            >
              {group.activeTabId}
            </div>
          ))}
        </div>
      ),
    });

    const separators = screen.getAllByRole("separator");
    const headerSeparator = separators.find(
      (separator) =>
        separator.parentElement?.dataset.sidebarSplitSurface === "header",
    );
    const bodySeparator = separators.find(
      (separator) =>
        separator.parentElement?.dataset.sidebarSplitSurface === "body",
    );
    expect(headerSeparator).toBeInstanceOf(HTMLElement);
    expect(bodySeparator).toBeInstanceOf(HTMLElement);
    if (
      !(headerSeparator instanceof HTMLElement) ||
      !(bodySeparator instanceof HTMLElement)
    ) {
      return;
    }
    expect(headerSeparator.className).toContain("bg-border-seam-vertical/60");
    expect(bodySeparator.className).toContain("bg-transparent");

    const headerPrevious = headerSeparator.previousElementSibling;
    const headerNext = headerSeparator.nextElementSibling;
    const bodyPrevious = bodySeparator.previousElementSibling;
    const bodyNext = bodySeparator.nextElementSibling;
    const bodyHitTarget = bodySeparator.firstElementChild;
    if (
      !(headerPrevious instanceof HTMLElement) ||
      !(headerNext instanceof HTMLElement) ||
      !(bodyPrevious instanceof HTMLElement) ||
      !(bodyNext instanceof HTMLElement) ||
      !(bodyHitTarget instanceof HTMLElement)
    ) {
      throw new Error("Expected synchronized header and body resize pairs");
    }
    Object.defineProperty(bodyHitTarget, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(bodyPrevious, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(bodyNext, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 401,
      right: 801,
      top: 0,
      width: 400,
      x: 401,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(bodyHitTarget, { clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(bodyHitTarget, { clientX: 600, pointerId: 1 });

    expect(headerPrevious.style.flex).toBe(bodyPrevious.style.flex);
    expect(headerNext.style.flex).toBe(bodyNext.style.flex);
    expect(Number.parseFloat(headerPrevious.style.flex)).toBeCloseTo(0.749, 3);
    expect(Number.parseFloat(headerNext.style.flex)).toBeCloseTo(0.251, 3);
    for (const pane of document.querySelectorAll<HTMLElement>(
      "[data-sidebar-split-tab-slot]",
    )) {
      const paneId = pane.dataset.sidebarSplitTabSlot;
      expect(pane.className).toContain("overflow-hidden");
      expect(
        pane.querySelector(`[data-testid='header-label-${paneId}']`)
          ?.textContent,
      ).toBe(
        document.querySelector(`[data-testid='body-label-${paneId}']`)
          ?.textContent,
      );
    }

    fireEvent.pointerUp(bodyHitTarget, { clientX: 600, pointerId: 1 });
    expect(headerPrevious.style.flex).toBe(bodyPrevious.style.flex);
    expect(headerNext.style.flex).toBe(bodyNext.style.flex);
  });

  it("resizes the adjacent panes from the shared-header separator", () => {
    persistState(createTwoPaneState());
    renderContainer({
      renderPane: ({ paneId }) => <div>{paneId}</div>,
      renderSplitHeader: ({ renderTabGroups }) => (
        <div>
          {renderTabGroups(({ paneId }) => (
            <div>{paneId}</div>
          ))}
        </div>
      ),
    });

    const headerSeparator = screen
      .getAllByRole("separator")
      .find(
        (separator) =>
          separator.parentElement?.dataset.sidebarSplitSurface === "header",
      );
    if (!(headerSeparator instanceof HTMLElement)) {
      throw new Error("Expected shared-header resize separator");
    }
    const hitTarget = headerSeparator.firstElementChild;
    const headerPrevious = headerSeparator.previousElementSibling;
    const headerNext = headerSeparator.nextElementSibling;
    const bodyTrack = document.querySelector<HTMLElement>(
      '[data-sidebar-split-surface="body"][data-sidebar-split-track="root"]',
    );
    const bodyChildren = Array.from(bodyTrack?.children ?? []).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.dataset.sidebarSplitChildIndex !== undefined,
    );
    if (
      !(hitTarget instanceof HTMLElement) ||
      !(headerPrevious instanceof HTMLElement) ||
      !(headerNext instanceof HTMLElement) ||
      bodyChildren.length !== 2
    ) {
      throw new Error("Expected header and body resize elements");
    }
    Object.defineProperty(hitTarget, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(headerPrevious, "getBoundingClientRect").mockReturnValue({
      bottom: 48,
      height: 48,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(headerNext, "getBoundingClientRect").mockReturnValue({
      bottom: 48,
      height: 48,
      left: 401,
      right: 801,
      top: 0,
      width: 400,
      x: 401,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(hitTarget, { clientX: 400, pointerId: 2 });
    fireEvent.pointerMove(hitTarget, { clientX: 250, pointerId: 2 });
    expect(bodyChildren[0]?.style.flex).toBe(headerPrevious.style.flex);
    expect(bodyChildren[1]?.style.flex).toBe(headerNext.style.flex);
    fireEvent.pointerUp(hitTarget, { clientX: 600, pointerId: 99 });
    expect(headerSeparator.dataset.dragging).toBe("true");
    fireEvent.pointerUp(hitTarget, { clientX: 600, pointerId: 2 });
    expect(bodyChildren[0]?.style.flex).toBe(headerPrevious.style.flex);
    expect(bodyChildren[1]?.style.flex).toBe(headerNext.style.flex);
    expect(Number.parseFloat(headerPrevious.style.flex)).toBeCloseTo(0.749, 3);
    expect(Number.parseFloat(headerNext.style.flex)).toBeCloseTo(0.251, 3);
    expect(headerSeparator.dataset.dragging).toBeUndefined();
  });

  it("does not resize or persist when a shared-header separator is pressed and released in place", () => {
    persistState(createTwoPaneState());
    const storageKey = sidebarSplitStorageKey(PANEL_STATE_ID);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderContainer({
      renderPane: ({ paneId }) => <div>{paneId}</div>,
      renderSplitHeader: ({ renderTabGroups }) => (
        <div>
          {renderTabGroups(({ paneId }) => (
            <div>{paneId}</div>
          ))}
        </div>
      ),
    });
    const storedState = window.localStorage.getItem(storageKey);
    setItem.mockClear();

    const headerSeparator = screen
      .getAllByRole("separator")
      .find(
        (separator) =>
          separator.parentElement?.dataset.sidebarSplitSurface === "header",
      );
    const bodySeparator = screen
      .getAllByRole("separator")
      .find(
        (separator) =>
          separator.parentElement?.dataset.sidebarSplitSurface === "body",
      );
    const hitTarget = headerSeparator?.firstElementChild;
    const headerPrevious = headerSeparator?.previousElementSibling;
    const headerNext = headerSeparator?.nextElementSibling;
    const bodyPrevious = bodySeparator?.previousElementSibling;
    const bodyNext = bodySeparator?.nextElementSibling;
    if (
      !(headerSeparator instanceof HTMLElement) ||
      !(hitTarget instanceof HTMLElement) ||
      !(headerPrevious instanceof HTMLElement) ||
      !(headerNext instanceof HTMLElement) ||
      !(bodyPrevious instanceof HTMLElement) ||
      !(bodyNext instanceof HTMLElement)
    ) {
      throw new Error("Expected synchronized header and body resize elements");
    }
    Object.defineProperty(hitTarget, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(headerPrevious, "getBoundingClientRect").mockReturnValue({
      bottom: 48,
      height: 48,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(headerNext, "getBoundingClientRect").mockReturnValue({
      bottom: 48,
      height: 48,
      left: 401,
      right: 801,
      top: 0,
      width: 400,
      x: 401,
      y: 0,
      toJSON: () => ({}),
    });
    const initialFlex = [
      headerPrevious.style.flex,
      headerNext.style.flex,
      bodyPrevious.style.flex,
      bodyNext.style.flex,
    ];

    fireEvent.pointerDown(hitTarget, { clientX: 400, pointerId: 22 });
    fireEvent.pointerUp(hitTarget, { clientX: 400, pointerId: 22 });

    expect([
      headerPrevious.style.flex,
      headerNext.style.flex,
      bodyPrevious.style.flex,
      bodyNext.style.flex,
    ]).toEqual(initialFlex);
    expect(window.localStorage.getItem(storageKey)).toBe(storedState);
    expect(
      setItem.mock.calls.filter(([key]) => key === storageKey),
    ).toHaveLength(0);
    expect(headerSeparator.dataset.dragging).toBeUndefined();
  });

  it("resizes stacked panes from their shared-header separator and restores cancellation", () => {
    persistState(createStackedPaneState());
    renderContainer({
      renderPane: ({ paneId }) => <div>{paneId}</div>,
      renderSplitHeader: ({ renderTabGroups }) => (
        <div>{renderTabGroups(({ paneId }) => <div>{paneId}</div>)}</div>
      ),
    });

    const headerSeparator = screen
      .getAllByRole("separator")
      .find(
        (separator) =>
          separator.parentElement?.dataset.sidebarSplitSurface === "header",
      );
    expect(headerSeparator).toBeInstanceOf(HTMLElement);
    expect(headerSeparator?.className).toContain(
      "bg-border-seam-vertical/60",
    );
    const bodySeparator = screen.getByRole("separator", {
      name: "Resize stacked right panel panes",
    });
    const hitTarget = headerSeparator?.firstElementChild;
    const headerPrevious = headerSeparator?.previousElementSibling;
    const headerNext = headerSeparator?.nextElementSibling;
    const bodyPrevious = bodySeparator.previousElementSibling;
    const bodyNext = bodySeparator.nextElementSibling;
    if (
      !(headerSeparator instanceof HTMLElement) ||
      !(hitTarget instanceof HTMLElement) ||
      !(headerPrevious instanceof HTMLElement) ||
      !(headerNext instanceof HTMLElement) ||
      !(bodyPrevious instanceof HTMLElement) ||
      !(bodyNext instanceof HTMLElement)
    ) {
      throw new Error("Expected stacked header and body resize elements");
    }
    Object.defineProperty(hitTarget, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(headerPrevious, "getBoundingClientRect").mockReturnValue({
      bottom: 48,
      height: 48,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(headerNext, "getBoundingClientRect").mockReturnValue({
      bottom: 48,
      height: 48,
      left: 401,
      right: 801,
      top: 0,
      width: 400,
      x: 401,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(hitTarget, { clientX: 400, pointerId: 3 });
    fireEvent.pointerMove(hitTarget, { clientX: 520, pointerId: 3 });
    expect(headerPrevious.style.flex).toBe(bodyPrevious.style.flex);
    expect(headerNext.style.flex).toBe(bodyNext.style.flex);
    expect(Number.parseFloat(headerPrevious.style.flex)).toBeCloseTo(0.649, 3);

    fireEvent.pointerUp(hitTarget, { clientX: 600, pointerId: 3 });
    expect(headerPrevious.style.flex).toBe(bodyPrevious.style.flex);
    expect(headerNext.style.flex).toBe(bodyNext.style.flex);
    expect(Number.parseFloat(bodyPrevious.style.flex)).toBeCloseTo(0.749, 3);
    expect(Number.parseFloat(bodyNext.style.flex)).toBeCloseTo(0.251, 3);

    const committedPreviousFlex = headerPrevious.style.flex;
    const committedNextFlex = headerNext.style.flex;
    fireEvent.pointerDown(hitTarget, { clientX: 600, pointerId: 4 });
    fireEvent.pointerMove(hitTarget, { clientX: 320, pointerId: 4 });
    expect(headerPrevious.style.flex).not.toBe(committedPreviousFlex);
    expect(bodyPrevious.style.flex).toBe(headerPrevious.style.flex);
    fireEvent.pointerCancel(hitTarget, { clientX: 320, pointerId: 4 });
    expect(headerPrevious.style.flex).toBe(committedPreviousFlex);
    expect(headerNext.style.flex).toBe(committedNextFlex);
    expect(bodyPrevious.style.flex).toBe(committedPreviousFlex);
    expect(bodyNext.style.flex).toBe(committedNextFlex);
  });

  it("restores both adjacent flex values after pointer cancellation", () => {
    persistState(createTwoPaneState());
    renderContainer({
      renderPane: ({ paneId }) => <div>{paneId}</div>,
    });

    const separator = screen.getByRole("separator");
    expect(separator.className).toContain("bg-transparent");
    expect(separator.className).not.toContain("bg-border-seam");
    const hitTarget = separator.firstElementChild;
    const previous = separator.previousElementSibling;
    const next = separator.nextElementSibling;
    expect(hitTarget).toBeInstanceOf(HTMLElement);
    expect(previous).toBeInstanceOf(HTMLElement);
    expect(next).toBeInstanceOf(HTMLElement);
    if (
      !(hitTarget instanceof HTMLElement) ||
      !(previous instanceof HTMLElement) ||
      !(next instanceof HTMLElement)
    ) {
      return;
    }
    Object.defineProperty(hitTarget, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(previous, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 400, top: 0, bottom: 600 }),
    });
    Object.defineProperty(next, "getBoundingClientRect", {
      value: () => ({ left: 401, right: 800, top: 0, bottom: 600 }),
    });
    const previousFlex = previous.style.flex;
    const nextFlex = next.style.flex;

    fireEvent.pointerDown(hitTarget, { clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(hitTarget, { clientX: 560, pointerId: 1 });
    expect(previous.style.flex).not.toBe(previousFlex);
    expect(next.style.flex).not.toBe(nextFlex);

    fireEvent.pointerCancel(hitTarget, { clientX: 560, pointerId: 1 });
    expect(previous.style.flex).toBe(previousFlex);
    expect(next.style.flex).toBe(nextFlex);
    expect(document.body.style.userSelect).toBe("");
  });

  it("does not write a canonical layout or rewrite a focused-pane no-op", () => {
    const storageKey = sidebarSplitStorageKey(PANEL_STATE_ID);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    renderContainer({
      renderPane: ({ paneId }) => (
        <button data-testid="only-pane" type="button">
          {paneId}
        </button>
      ),
      tabs: [TABS[0] as SidebarSplitTabDescriptor],
    });

    fireEvent.pointerDown(screen.getByTestId("only-pane"));
    expect(
      setItem.mock.calls.filter(([key]) => key === storageKey),
    ).toHaveLength(0);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("does not rewrite an unchanged restored split", () => {
    persistState(createTwoPaneState());
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId: PANEL_STATE_ID }),
      JSON.stringify({ lastUsedAt: Date.now() }),
    );
    const storageKey = sidebarSplitStorageKey(PANEL_STATE_ID);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    renderContainer({
      renderPane: ({ paneId }) => <div>{paneId}</div>,
    });

    expect(
      setItem.mock.calls.filter(([key]) => key === storageKey),
    ).toHaveLength(0);
  });
});
