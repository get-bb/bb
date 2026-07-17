// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { useContext, useMemo, useState, type ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  serializeSplitLayout,
  SPLIT_LAYOUT_STORAGE_KEY,
} from "@/lib/split-layout";
import type { PaneContent, SplitLayout } from "@/lib/split-layout";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PaneContext, usePaneSecondaryPanelRegistration } from "./PaneContext";
import { SplitThreadArea } from "./SplitThreadArea";
import { applyThreadOpenToLayout } from "./splitThreadNavigation";

// Per-thread archived/deleted state consulted by the mocked useThread, driving
// PaneStaleWatcher. Unknown threads read as "still loading" (never pruned).
const threadStore = vi.hoisted(
  () =>
    new Map<string, { archivedAt: number | null; deletedAt: number | null }>(),
);
const experimentState = vi.hoisted(() => ({ enabled: true }));
interface ShortcutPresentationFixture {
  ariaKeyshortcuts: string;
  label: string;
}
const commandPresentationState = vi.hoisted(
  (): {
    isModifierHeld: boolean;
    shortcut: ShortcutPresentationFixture | null;
  } => ({ isModifierHeld: false, shortcut: null }),
);

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => experimentState.enabled,
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: (id: string) => {
    const entry = threadStore.get(id);
    if (entry === undefined) {
      return { data: undefined, isSuccess: false, isError: false, error: null };
    }
    return {
      data: { id, archivedAt: entry.archivedAt, deletedAt: entry.deletedAt },
      isSuccess: true,
      isError: false,
      error: null,
    };
  },
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: () => undefined,
  useAppCommandHandler: () => undefined,
  useAppCommandShortcut: () => commandPresentationState.shortcut,
  useIsAppCommandModifierHeld: () => commandPresentationState.isModifierHeld,
  useIndexedAppCommandHandlers: () => undefined,
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  const PanelGroup = React.forwardRef<
    {
      getLayout: () => number[];
      setLayout: (layout: number[]) => void;
    },
    { children?: ReactNode }
  >(({ children }, ref) => {
    React.useImperativeHandle(
      ref,
      () => ({ getLayout: () => [100, 0], setLayout: () => undefined }),
      [],
    );
    return <div data-testid="workspace-panel-group">{children}</div>;
  });
  PanelGroup.displayName = "MockPanelGroup";
  const Panel = ({ children }: { children?: ReactNode }) => (
    <div data-testid="workspace-panel">{children}</div>
  );
  const PanelResizeHandle = () => (
    <div data-testid="workspace-panel-resize-handle" />
  );
  return { Panel, PanelGroup, PanelResizeHandle };
});

vi.mock("@/components/ui/sidebar.js", () => ({
  useIsSidebarShowing: () => true,
}));

// Lightweight stand-in for the heavyweight thread view. It surfaces the pane's
// thread id, focus, close affordance, and a real threadId-keyed draft so the
// test exercises SplitThreadArea's wiring without its dependency tree.
vi.mock("./ThreadDetailView", () => ({
  ThreadDetailView: ({
    projectId,
    threadId,
  }: {
    projectId: string;
    threadId: string;
  }) => {
    const pane = useContext(PaneContext);
    const [isPanelOpen, setIsPanelOpen] = useState(threadId === "thr-a");
    const panelModel = useMemo(
      () => ({
        collapsedRail: null,
        contentKey: threadId,
        isMainCollapsed: false,
        isOpen: isPanelOpen,
        panel: <div data-testid={`hosted-panel-${threadId}`} />,
        onToggle: () => setIsPanelOpen((open) => !open),
      }),
      [isPanelOpen, threadId],
    );
    usePaneSecondaryPanelRegistration(
      pane?.secondaryPanelHost ?? null,
      panelModel,
    );
    const draft = usePromptDraftStorage({
      kind: "thread",
      projectId,
      threadId,
    });
    return (
      <div
        data-testid={`pane-${threadId}`}
        data-focused={pane?.isFocused ? "true" : "false"}
      >
        <textarea
          data-testid={`draft-${threadId}`}
          value={draft.text}
          onChange={(event) => draft.setTextAndMentions(event.target.value, [])}
        />
        {pane?.onRequestClose ? (
          <button
            type="button"
            data-testid={`close-${threadId}`}
            onClick={pane.onRequestClose}
          >
            close
          </button>
        ) : null}
      </div>
    );
  },
}));

const { queryClient, wrapper: _wrapper } = createQueryClientTestHarness();
void _wrapper;

function threadContent(threadId: string) {
  return {
    kind: "thread" as const,
    projectId: PERSONAL_PROJECT_ID,
    threadId,
  };
}

function twoPaneLayout(focusedPaneId: "pane-1" | "pane-2"): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        { type: "pane", paneId: "pane-1", content: threadContent("thr-a") },
        { type: "pane", paneId: "pane-2", content: threadContent("thr-b") },
      ],
    },
    focusedPaneId,
  };
}

function eightPaneThreadLayout(): SplitLayout {
  let layout: SplitLayout | null = null;
  for (let index = 0; index < 8; index += 1) {
    layout = applyThreadOpenToLayout(
      layout,
      {
        projectId: PERSONAL_PROJECT_ID,
        threadId: `thr-${String.fromCharCode(97 + index)}`,
      },
      index === 0 ? "replace" : "right",
    );
  }
  if (layout === null) {
    throw new Error("Expected eight-pane layout");
  }
  return layout;
}

const docsContent: PaneContent = {
  kind: "plugin-panel",
  pluginId: "docs",
  panelPath: "docs",
  subPath: "",
};

function pluginContent(panelPath: string): PaneContent {
  return {
    kind: "plugin-panel",
    pluginId: "test-plugin",
    panelPath,
    subPath: "",
  };
}

function fourPanePluginLayout(): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        {
          type: "split",
          dir: "col",
          sizes: [0.5, 0.5],
          children: [
            {
              type: "pane",
              paneId: "pane-top-left",
              content: pluginContent("top-left"),
            },
            {
              type: "pane",
              paneId: "pane-bottom-left",
              content: pluginContent("bottom-left"),
            },
          ],
        },
        {
          type: "split",
          dir: "col",
          sizes: [0.5, 0.5],
          children: [
            {
              type: "pane",
              paneId: "pane-top-right",
              content: pluginContent("top-right"),
            },
            {
              type: "pane",
              paneId: "pane-bottom-right",
              content: pluginContent("bottom-right"),
            },
          ],
        },
      ],
    },
    focusedPaneId: "pane-bottom-right",
  };
}

function pluginSplitLayout(): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        { type: "pane", paneId: "pane-1", content: threadContent("thr-a") },
        { type: "pane", paneId: "pane-2", content: docsContent },
      ],
    },
    focusedPaneId: "pane-2",
  };
}

function threadPath(threadId: string): string {
  return `/threads/${threadId}`;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function ExternalNav({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="external-nav"
      onClick={() => navigate(to)}
    >
      go
    </button>
  );
}

function RouteAwareSplitArea() {
  const location = useLocation();
  return (
    <SplitThreadArea
      routeContent={
        location.pathname.startsWith("/plugins/") ? docsContent : undefined
      }
    />
  );
}

function renderSplitArea(options: {
  path: string;
  layout?: SplitLayout;
  externalTo?: string;
  routeContent?: PaneContent;
  routeAwareContent?: boolean;
}) {
  const store = createStore();
  if (options.layout !== undefined) {
    store.set(splitLayoutAtom, options.layout);
  }
  render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[options.path]}>
          {options.routeAwareContent ? (
            <RouteAwareSplitArea />
          ) : (
            <SplitThreadArea routeContent={options.routeContent} />
          )}
          <LocationProbe />
          {options.externalTo !== undefined ? (
            <ExternalNav to={options.externalTo} />
          ) : null}
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
  return store;
}

beforeEach(() => {
  experimentState.enabled = true;
  commandPresentationState.isModifierHeld = false;
  commandPresentationState.shortcut = null;
  threadStore.set("thr-a", { archivedAt: null, deletedAt: null });
  threadStore.set("thr-b", { archivedAt: null, deletedAt: null });
});

afterEach(() => {
  cleanup();
  threadStore.clear();
  resetPluginSlotStoreForTest();
  delete window.bbDesktop;
  window.localStorage.clear();
});

describe("SplitThreadArea", () => {
  it("keeps drag updates local and persists the resized pair once on release", () => {
    const store = renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
    });
    const separator = screen.getByRole("separator");
    const previous = separator.previousElementSibling;
    const next = separator.nextElementSibling;
    if (!(previous instanceof HTMLElement) || !(next instanceof HTMLElement)) {
      throw new Error("Expected adjacent split flex items");
    }

    Object.defineProperty(separator, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(previous, "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 300,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(next, "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 300,
      left: 406,
      right: 806,
      top: 0,
      width: 400,
      x: 406,
      y: 0,
      toJSON: () => ({}),
    });

    const scrollViewport = document.createElement("div");
    scrollViewport.style.overflowY = "auto";
    Object.defineProperties(scrollViewport, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    vi.spyOn(scrollViewport, "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 300,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const offscreenRow = document.createElement("div");
    offscreenRow.dataset.timelineRowId = "offscreen-row";
    vi.spyOn(offscreenRow, "getBoundingClientRect").mockReturnValue({
      bottom: -450,
      height: 50,
      left: 0,
      right: 400,
      top: -500,
      width: 400,
      x: 0,
      y: -500,
      toJSON: () => ({}),
    });
    scrollViewport.appendChild(offscreenRow);
    previous.appendChild(scrollViewport);

    const splitSizes = () => {
      const root = store.get(splitLayoutAtom)?.root;
      if (root?.type !== "split") {
        throw new Error("Expected split layout");
      }
      return root.sizes;
    };

    fireEvent.pointerDown(separator, { clientX: 403, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 564.2, pointerId: 1 });

    expect(splitSizes()).toEqual([0.5, 0.5]);
    expect(offscreenRow.style.contentVisibility).toBe("hidden");
    expect(offscreenRow.style.containIntrinsicBlockSize).toBe("50px");
    expect(Number.parseFloat(previous.style.flexGrow)).toBeCloseTo(0.7, 5);
    expect(Number.parseFloat(next.style.flexGrow)).toBeCloseTo(0.3, 5);

    fireEvent.pointerUp(separator, { clientX: 564.2, pointerId: 1 });

    expect(splitSizes()[0]).toBeCloseTo(0.7, 5);
    expect(splitSizes()[1]).toBeCloseTo(0.3, 5);
    expect(offscreenRow.style.contentVisibility).toBe("");
    expect(offscreenRow.style.containIntrinsicBlockSize).toBe("");
  });

  it("keeps the merged toggle absolute and places a visible shortcut hint below pane actions", async () => {
    commandPresentationState.isModifierHeld = true;
    commandPresentationState.shortcut = {
      ariaKeyshortcuts: "Control+Shift+P",
      label: "Ctrl Shift P",
    };
    renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
    });

    const toggle = await screen.findByTestId("split-workspace-panel-toggle");
    expect(toggle.classList).toContain("absolute");
    expect(toggle.classList).not.toContain("relative");
    expect(toggle.classList).toContain("right-2.5");
    expect(toggle.classList).toContain("top-2.5");
    const hint = screen.getByText("Ctrl Shift P");
    expect(hint.classList).toContain("absolute");
    expect(hint.classList).toContain("right-0");
    expect(hint.classList).toContain("top-full");
  });

  it("hosts one panel whose visibility survives focus changes between panes", async () => {
    renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
    });

    const toggle = await screen.findByTestId("split-workspace-panel-toggle");
    expect(
      screen.queryAllByTestId("split-workspace-panel-toggle"),
    ).toHaveLength(1);
    expect(screen.getByTestId("hosted-panel-thr-a")).toBeTruthy();
    expect(screen.queryByTestId("hosted-panel-thr-b")).toBeNull();
    expect(toggle.querySelector("button")?.getAttribute("aria-pressed")).toBe(
      "true",
    );

    // thr-b's own persisted panel state is closed, but refocusing must swap
    // the panel's content without closing the window-level panel.
    fireEvent.pointerDown(screen.getByTestId("pane-thr-b"));
    await screen.findByTestId("hosted-panel-thr-b");
    expect(screen.queryByTestId("hosted-panel-thr-a")).toBeNull();
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    // An explicit toggle closes it, and the closed state also survives
    // refocusing the pane whose panel was originally open.
    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.pointerDown(screen.getByTestId("pane-thr-a"));
    await screen.findByTestId("hosted-panel-thr-a");
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("keeps the open panel as an empty state on a pane with no panel support", async () => {
    const layout = pluginSplitLayout();
    layout.focusedPaneId = "pane-1";
    renderSplitArea({
      path: threadPath("thr-a"),
      layout,
      routeAwareContent: true,
    });

    const toggle = await screen.findByTestId("split-workspace-panel-toggle");
    expect(toggle.querySelector("button")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.queryByTestId("split-workspace-empty-panel-state"),
    ).toBeNull();
    const pluginPane = document.querySelector('[data-split-pane-id="pane-2"]');
    if (!(pluginPane instanceof HTMLElement)) {
      throw new Error("Expected plugin split pane");
    }

    // Focusing the plugin pane keeps the panel open, swapping its content for
    // the empty state; the toggle stays put and stays pressed.
    fireEvent.pointerDown(pluginPane);
    await screen.findByTestId("split-workspace-empty-panel-state");
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    // The toggle closes the window panel from the plugin pane, and the closed
    // state survives refocusing the thread pane (imposed on its persisted
    // state).
    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.pointerDown(screen.getByTestId("pane-thr-a"));
    const restoredClosedToggle = await screen.findByRole("button", {
      name: "Show right panel",
    });
    expect(restoredClosedToggle.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.queryByTestId("split-workspace-empty-panel-state"),
    ).toBeNull();
  });

  it("mounts both panes with independent, threadId-keyed drafts", async () => {
    renderSplitArea({
      path: threadPath("thr-b"),
      layout: twoPaneLayout("pane-2"),
    });

    expect(await screen.findByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.getByTestId("pane-thr-b")).toBeTruthy();

    fireEvent.change(screen.getByTestId("draft-thr-a"), {
      target: { value: "note for A" },
    });

    // The typed draft stays in pane A's storage key; pane B is untouched.
    expect(
      (screen.getByTestId("draft-thr-a") as HTMLTextAreaElement).value,
    ).toBe("note for A");
    expect(
      (screen.getByTestId("draft-thr-b") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("replaces the focused pane's content on external navigation without dismantling the layout", async () => {
    renderSplitArea({
      path: threadPath("thr-b"),
      layout: twoPaneLayout("pane-2"),
      externalTo: threadPath("thr-c"),
    });
    await screen.findByTestId("pane-thr-b");

    fireEvent.click(screen.getByTestId("external-nav"));

    // Focused pane (thr-b) now shows thr-c; the unfocused pane (thr-a) survives.
    expect(await screen.findByTestId("pane-thr-c")).toBeTruthy();
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.queryByTestId("pane-thr-b")).toBeNull();
  });

  it("focuses an already-open pane instead of duplicating on external navigation", async () => {
    renderSplitArea({
      path: threadPath("thr-b"),
      layout: twoPaneLayout("pane-2"),
      externalTo: threadPath("thr-a"),
    });
    await screen.findByTestId("pane-thr-b");

    fireEvent.click(screen.getByTestId("external-nav"));

    await waitFor(() => {
      expect(screen.getByTestId("pane-thr-a").dataset.focused).toBe("true");
    });
    expect(screen.getByTestId("pane-thr-b").dataset.focused).toBe("false");
    // No duplication — still exactly two panes.
    expect(screen.queryAllByTestId(/^pane-/)).toHaveLength(2);
  });

  it("restores a persisted layout on load", async () => {
    renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
    });

    expect(await screen.findByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.getByTestId("pane-thr-b")).toBeTruthy();
  });

  it("restores eight successive default-right opens, then focuses and closes with valid URL state", async () => {
    const layout = eightPaneThreadLayout();
    expect(layout.root).toMatchObject({
      type: "split",
      dir: "row",
      sizes: Array.from({ length: 8 }, () => 1 / 8),
    });
    window.localStorage.setItem(
      SPLIT_LAYOUT_STORAGE_KEY,
      serializeSplitLayout(layout),
    );

    const store = renderSplitArea({ path: threadPath("thr-h") });

    for (const suffix of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      expect(await screen.findByTestId(`pane-thr-${suffix}`)).toBeTruthy();
    }
    expect(document.querySelectorAll("[data-split-pane-id]")).toHaveLength(8);
    expect(screen.getByTestId("pane-thr-h").dataset.focused).toBe("true");

    fireEvent.pointerDown(screen.getByTestId("pane-thr-f"));
    await waitFor(() => {
      expect(screen.getByTestId("pane-thr-f").dataset.focused).toBe("true");
      expect(screen.getByTestId("location").textContent).toBe(
        threadPath("thr-f"),
      );
    });

    fireEvent.click(screen.getByTestId("close-thr-f"));
    await waitFor(() => {
      expect(screen.queryByTestId("pane-thr-f")).toBeNull();
      expect(screen.getByTestId("location").textContent).toBe(
        threadPath("thr-g"),
      );
    });
    expect(store.get(splitLayoutAtom)?.focusedPaneId).toBe("pane-7");
    expect(document.querySelectorAll("[data-split-pane-id]")).toHaveLength(7);
  });

  it("carves a plugin pane drag handle out of the macOS window-drag region", async () => {
    const desktopInfo: BbDesktopInfo = {
      lastCheckedAt: null,
      latestVersion: null,
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.0-test",
    };
    window.bbDesktop = createBbDesktopApi(desktopInfo);
    setPluginSlotRegistrations("docs", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [
        {
          id: "docs",
          title: "Docs",
          icon: "FileText",
          path: "docs",
          component: () => <div>Docs panel</div>,
        },
      ],
      threadPanelActions: [],
      composerAccessories: [],
      pendingInteractions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });

    renderSplitArea({
      path: "/plugins/docs/docs",
      layout: pluginSplitLayout(),
      routeContent: docsContent,
    });

    const title = await screen.findByText("Docs");
    const dragHandle = title.parentElement?.parentElement;
    expect(dragHandle?.className).toContain("cursor-grab");
    expect(dragHandle?.className).toContain("[app-region:no-drag]");
    expect(dragHandle?.className).toContain("[-webkit-app-region:no-drag]");
  });

  it("makes only top-row split headers desktop window-drag regions", async () => {
    const desktopInfo: BbDesktopInfo = {
      lastCheckedAt: null,
      latestVersion: null,
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.0-test",
    };
    window.bbDesktop = createBbDesktopApi(desktopInfo);
    setPluginSlotRegistrations("test-plugin", {
      homepageSections: [],
      settingsSections: [],
      navPanels: ["top-left", "bottom-left", "top-right", "bottom-right"].map(
        (path) => ({
          id: path,
          title: path,
          icon: "FileText",
          path,
          component: () => <div>{path} panel</div>,
        }),
      ),
      threadPanelActions: [],
      composerAccessories: [],
      pendingInteractions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });

    renderSplitArea({
      path: "/plugins/test-plugin/bottom-right",
      layout: fourPanePluginLayout(),
      routeContent: pluginContent("bottom-right"),
    });

    for (const path of ["top-left", "top-right"]) {
      const header = (await screen.findByText(path)).closest("header");
      expect(header?.className).toContain("[app-region:drag]");
      expect(header?.className).toContain("[-webkit-app-region:drag]");
    }
    for (const path of ["bottom-left", "bottom-right"]) {
      const header = (await screen.findByText(path)).closest("header");
      expect(header?.className).not.toContain("[app-region:drag]");
      expect(header?.className).not.toContain("[-webkit-app-region:drag]");
    }
  });

  it("places plugin header actions before the pane close button", async () => {
    setPluginSlotRegistrations("docs", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [
        {
          id: "docs",
          title: "Docs",
          icon: "FileText",
          path: "docs",
          component: () => <div>Docs panel</div>,
          headerContent: () => (
            <button type="button">Toggle docs sidebar</button>
          ),
        },
      ],
      threadPanelActions: [],
      composerAccessories: [],
      pendingInteractions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });

    renderSplitArea({
      path: "/plugins/docs/docs",
      layout: pluginSplitLayout(),
      routeContent: docsContent,
    });

    const toggle = await screen.findByRole("button", {
      name: "Toggle docs sidebar",
    });
    const close = screen.getByRole("button", { name: "Close pane" });
    expect(
      toggle.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("falls back to a single pane from the route when persisted state is malformed", async () => {
    window.localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, "not json");
    renderSplitArea({ path: threadPath("thr-a") });

    expect(await screen.findByTestId("pane-thr-a")).toBeTruthy();
    // Only the route thread renders — no stale panes leak in.
    expect(screen.queryAllByTestId(/^pane-/)).toHaveLength(1);
    expect(screen.queryByTestId("close-thr-a")).toBeNull();
  });

  it("moves the URL to the surviving pane when the focused pane is closed", async () => {
    renderSplitArea({
      path: threadPath("thr-b"),
      layout: twoPaneLayout("pane-2"),
    });
    await screen.findByTestId("pane-thr-b");

    fireEvent.click(screen.getByTestId("close-thr-b"));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        threadPath("thr-a"),
      );
    });
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.queryByTestId("pane-thr-b")).toBeNull();
  });

  it("prunes a stale (archived) pane from a restored split", async () => {
    threadStore.set("thr-b", { archivedAt: 123, deletedAt: null });
    renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
    });

    // thr-b is archived, so its pane is pruned; the valid focused pane remains.
    await waitFor(() => {
      expect(screen.queryByTestId("pane-thr-b")).toBeNull();
    });
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe(
      threadPath("thr-a"),
    );
  });

  it("prunes a stale focused pane and moves focus + URL to the survivor", async () => {
    threadStore.set("thr-b", { archivedAt: null, deletedAt: 456 });
    renderSplitArea({
      path: threadPath("thr-b"),
      layout: twoPaneLayout("pane-2"),
    });

    await waitFor(() => {
      expect(screen.queryByTestId("pane-thr-b")).toBeNull();
    });
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        threadPath("thr-a"),
      );
    });
  });
});
