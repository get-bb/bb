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
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { maximizedPaneIdAtom, splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  movePane,
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
import {
  usePluginComposerHost,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
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
const viewportState = vi.hoisted(() => ({ compact: false }));
const sidebarState = vi.hoisted(() => ({ showing: true }));
const commandHandlers = vi.hoisted(() => new Map<string, () => boolean>());
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

function HostedComposerScopeProbe({ threadId }: { threadId: string }) {
  const composerHost = usePluginComposerHost();
  return (
    <div data-testid={`hosted-composer-scope-${threadId}`}>
      {composerHost?.scope.kind === "thread"
        ? composerHost.scope.threadId
        : "missing"}
    </div>
  );
}

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => experimentState.enabled,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewportState.compact,
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
  useAppCommandHandler: (command: string, handler: () => boolean) => {
    commandHandlers.set(command, handler);
  },
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
  const PanelResizeHandle = ({
    className,
    id,
  }: {
    className?: string;
    id?: string;
  }) => (
    <div
      id={id}
      className={className}
      data-testid="workspace-panel-resize-handle"
    />
  );
  return { Panel, PanelGroup, PanelResizeHandle };
});

vi.mock("@/components/ui/sidebar.js", () => ({
  useIsSidebarShowing: () => sidebarState.showing,
}));

vi.mock("@/views/RootComposeView", () => ({
  RootComposeView: () => <div data-testid="root-compose-view" />,
}));

// Lightweight stand-in for the heavyweight thread view. It surfaces the pane's
// thread id, focus, close affordance, and a real threadId-keyed draft so the
// test exercises SplitThreadArea's wiring without its dependency tree.
vi.mock("./ThreadDetailView", () => ({
  ThreadDetailView: ({
    projectId = "proj_personal",
    threadId = "thr-a",
  }: {
    projectId: string;
    threadId: string;
  }) => {
    const pane = useContext(PaneContext);
    const [isPanelOpen, setIsPanelOpen] = useState(threadId === "thr-a");
    const composerHost = useMemo<PluginComposerHost>(() => {
      const draft = { attachments: [], mentions: [], text: "" };
      return {
        scope: { kind: "thread", threadId },
        draft,
        textEffectKey: `test-draft-${threadId}`,
        getCurrent: () => draft,
        setDraft: () => undefined,
        focus: () => undefined,
      };
    }, [threadId]);
    const panelModel = useMemo(
      () => ({
        composerHost,
        contentKey: threadId,
        isMainCollapsed: false,
        isOpen: isPanelOpen,
        panel: (
          <div data-testid={`hosted-panel-${threadId}`}>
            <HostedComposerScopeProbe threadId={threadId} />
          </div>
        ),
        onToggle: () => setIsPanelOpen((open) => !open),
      }),
      [composerHost, isPanelOpen, threadId],
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
        data-window-top-left-owner={pane?.ownsWindowTopLeft ? "true" : "false"}
      >
        <div
          data-testid={`drag-${threadId}`}
          onPointerDown={(event) => pane?.beginPaneDrag?.(event, threadId)}
        />
        <textarea
          data-testid={`draft-${threadId}`}
          value={draft.text}
          onChange={(event) => draft.setTextAndMentions(event.target.value, [])}
        />
        <div
          data-testid={`scroll-${threadId}`}
          style={{ height: 20, overflow: "auto" }}
        >
          <div style={{ height: 100 }} />
        </div>
        {pane?.onRequestClose ? (
          <button
            type="button"
            data-testid={`close-${threadId}`}
            onClick={pane.onRequestClose}
          >
            close
          </button>
        ) : null}
        {pane?.onToggleMaximize ? (
          <button
            type="button"
            data-testid={`maximize-${threadId}`}
            onClick={pane.onToggleMaximize}
          >
            {pane.isMaximized ? "restore" : "maximize"}
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

const newThreadContent: PaneContent = { kind: "new-thread" };

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
  maximizedPaneId?: string;
}) {
  const store = createStore();
  if (options.layout !== undefined) {
    store.set(splitLayoutAtom, options.layout);
  }
  if (options.maximizedPaneId !== undefined) {
    store.set(maximizedPaneIdAtom, options.maximizedPaneId);
  }
  render(
    <TooltipProvider>
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
      </JotaiProvider>
    </TooltipProvider>,
  );
  return store;
}

beforeEach(() => {
  experimentState.enabled = true;
  viewportState.compact = false;
  sidebarState.showing = true;
  commandHandlers.clear();
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
  window.sessionStorage.clear();
});

describe("SplitThreadArea", () => {
  it("maximizes without changing the split tree and restores mounted pane state", async () => {
    const initialLayout = twoPaneLayout("pane-1");
    const store = renderSplitArea({
      path: threadPath("thr-a"),
      layout: initialLayout,
    });
    fireEvent.change(await screen.findByTestId("draft-thr-b"), {
      target: { value: "preserve this hidden draft" },
    });

    fireEvent.click(screen.getByTestId("maximize-thr-a"));

    const paneA = document.querySelector<HTMLElement>(
      '[data-split-pane-id="pane-1"]',
    );
    const paneB = document.querySelector<HTMLElement>(
      '[data-split-pane-id="pane-2"]',
    );
    expect(paneA?.getAttribute("data-maximized")).toBe("true");
    expect(paneA?.className).toContain("absolute");
    expect(paneB?.className).toContain("invisible");
    expect(paneB?.getAttribute("aria-hidden")).toBe("true");
    expect(paneB?.style.contentVisibility).toBe("hidden");
    expect(screen.getByTestId("draft-thr-b")).toBeTruthy();
    expect(store.get(splitLayoutAtom)?.root).toEqual(initialLayout.root);
    expect(store.get(maximizedPaneIdAtom)).toBe("pane-1");

    fireEvent.click(screen.getByTestId("maximize-thr-a"));

    expect(paneA?.getAttribute("data-maximized")).toBeNull();
    expect(paneB?.className).not.toContain("invisible");
    expect(paneB?.style.contentVisibility).toBe("");
    expect(
      (screen.getByTestId("draft-thr-b") as HTMLTextAreaElement).value,
    ).toBe("preserve this hidden draft");
    expect(store.get(splitLayoutAtom)?.root).toEqual(initialLayout.root);
    expect(store.get(maximizedPaneIdAtom)).toBeNull();
    // Clear the deferred draft through the public hook before unmounting so
    // its debounce cannot repopulate storage during a later test.
    fireEvent.change(screen.getByTestId("draft-thr-b"), {
      target: { value: "" },
    });
  });

  it("preserves a hidden pane's mounted scroll position through restore", async () => {
    renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
    });
    const hiddenScroller = screen.getByTestId("scroll-thr-b");
    hiddenScroller.scrollTop = 12;
    fireEvent.scroll(hiddenScroller);

    fireEvent.click(screen.getByTestId("maximize-thr-a"));
    const hiddenPane = screen
      .getByTestId("pane-thr-b")
      .closest("[data-split-pane-id]");
    await waitFor(() =>
      expect(hiddenPane?.getAttribute("aria-hidden")).toBe("true"),
    );

    // Emulate the browser/timeline normalization observed in real-product QA.
    hiddenScroller.scrollTop = 0;
    fireEvent.scroll(hiddenScroller);
    fireEvent.click(screen.getByTestId("maximize-thr-a"));

    await waitFor(() => expect(hiddenScroller.scrollTop).toBe(12));
    expect(hiddenPane?.getAttribute("aria-hidden")).toBeNull();

    hiddenScroller.scrollTop = 0;
    fireEvent.click(screen.getByTestId("maximize-thr-a"));
    fireEvent.click(screen.getByTestId("maximize-thr-a"));
    // The restore transition no longer owns this element after the intentional
    // visible scroll to zero, so it does not replay the older saved offset.
    await waitFor(() => expect(hiddenScroller.scrollTop).toBe(0));
  });

  it("toggles the focused pane through the discoverable app command", async () => {
    const store = renderSplitArea({
      path: threadPath("thr-b"),
      layout: twoPaneLayout("pane-2"),
    });
    await screen.findByTestId("pane-thr-b");

    expect(commandHandlers.get("pane.maximize.toggle")?.()).toBe(true);
    await waitFor(() => expect(store.get(maximizedPaneIdAtom)).toBe("pane-2"));
    expect(commandHandlers.get("pane.maximize.toggle")?.()).toBe(true);
    await waitFor(() => expect(store.get(maximizedPaneIdAtom)).toBeNull());
  });

  it("carries maximization through focus, CLI-style open, and pane move", async () => {
    const store = renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
      maximizedPaneId: "pane-1",
    });
    await screen.findByTestId("pane-thr-a");

    expect(commandHandlers.get("pane.focus.next")?.()).toBe(true);
    await waitFor(() => expect(store.get(maximizedPaneIdAtom)).toBe("pane-2"));

    const opened = applyThreadOpenToLayout(
      store.get(splitLayoutAtom),
      { projectId: PERSONAL_PROJECT_ID, threadId: "thr-c" },
      "right",
    );
    store.set(splitLayoutAtom, opened);
    await waitFor(() => expect(store.get(maximizedPaneIdAtom)).toBe("pane-3"));

    store.set(splitLayoutAtom, movePane(opened, "pane-3", "pane-1", "left"));
    await waitFor(() => expect(store.get(maximizedPaneIdAtom)).toBe("pane-3"));
    expect(document.querySelectorAll("[data-split-pane-id]")).toHaveLength(3);
  });

  it("reveals move targets during a maximized drag and restores after drop", async () => {
    const store = renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
      maximizedPaneId: "pane-1",
    });
    await screen.findByTestId("pane-thr-a");
    const paneA = document.querySelector<HTMLElement>(
      '[data-split-pane-id="pane-1"]',
    );
    const paneB = document.querySelector<HTMLElement>(
      '[data-split-pane-id="pane-2"]',
    );
    if (paneA === null || paneB === null)
      throw new Error("Missing split panes");
    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn((x: number) =>
      x >= 500 ? [paneB] : [paneA],
    ) as typeof document.elementsFromPoint;
    Object.defineProperty(paneA, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        right: 500,
        top: 0,
        bottom: 800,
        width: 500,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(paneB, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 500,
        right: 1000,
        top: 0,
        bottom: 800,
        width: 500,
        height: 800,
        x: 500,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    try {
      fireEvent.pointerDown(screen.getByTestId("drag-thr-a"), {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(window, { clientX: 130, clientY: 100 });
      await waitFor(() => expect(store.get(maximizedPaneIdAtom)).toBeNull());
      expect(paneB.className).not.toContain("invisible");

      fireEvent.pointerMove(window, { clientX: 750, clientY: 400 });
      fireEvent.pointerUp(window, { clientX: 750, clientY: 400 });
      // A browser synthesizes this click after pointerup; the drag session
      // intentionally swallows it. Emit it so the listener cannot leak into
      // the next test in jsdom.
      fireEvent.click(window);

      await waitFor(() =>
        expect(store.get(maximizedPaneIdAtom)).toBe("pane-2"),
      );
      expect(store.get(splitLayoutAtom)?.root).toMatchObject({
        type: "split",
        children: [
          {
            type: "pane",
            paneId: "pane-1",
            content: { kind: "thread", threadId: "thr-b" },
          },
          {
            type: "pane",
            paneId: "pane-2",
            content: { kind: "thread", threadId: "thr-a" },
          },
        ],
      });
      expect(paneA.className).toContain("invisible");
      expect(paneB.getAttribute("data-maximized")).toBe("true");
    } finally {
      document.elementsFromPoint = originalElementsFromPoint;
    }
  });

  it("restores maximization when an engaged pane drag is cancelled", async () => {
    const initialLayout = twoPaneLayout("pane-1");
    const store = renderSplitArea({
      path: threadPath("thr-a"),
      layout: initialLayout,
      maximizedPaneId: "pane-1",
    });
    await screen.findByTestId("pane-thr-a");

    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn(
      () => [],
    ) as typeof document.elementsFromPoint;
    try {
      fireEvent.pointerDown(screen.getByTestId("drag-thr-a"), {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(window, { clientX: 130, clientY: 100 });
      await waitFor(() => expect(store.get(maximizedPaneIdAtom)).toBeNull());
      fireEvent.pointerCancel(window, { clientX: 130, clientY: 100 });
      fireEvent.click(window);

      await waitFor(() =>
        expect(store.get(maximizedPaneIdAtom)).toBe("pane-1"),
      );
      expect(store.get(splitLayoutAtom)?.root).toEqual(initialLayout.root);
    } finally {
      document.elementsFromPoint = originalElementsFromPoint;
    }
  });

  it("restores survivors when the maximized pane closes", async () => {
    const store = renderSplitArea({
      path: threadPath("thr-b"),
      layout: twoPaneLayout("pane-2"),
      maximizedPaneId: "pane-2",
    });
    await screen.findByTestId("pane-thr-b");

    fireEvent.click(screen.getByTestId("close-thr-b"));

    await waitFor(() => expect(screen.queryByTestId("pane-thr-b")).toBeNull());
    expect(store.get(maximizedPaneIdAtom)).toBeNull();
    expect(document.querySelector('[data-split-pane-id="pane-1"]')).toBeNull();
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
  });

  it("suppresses split maximization on compact viewports without discarding it", async () => {
    viewportState.compact = true;
    const store = renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
      maximizedPaneId: "pane-1",
    });

    expect(await screen.findByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.queryByTestId("pane-thr-b")).toBeNull();
    expect(screen.queryByTestId("maximize-thr-a")).toBeNull();
    expect(store.get(splitLayoutAtom)?.root.type).toBe("split");
    expect(store.get(maximizedPaneIdAtom)).toBe("pane-1");
  });

  it("recedes inactive pane bodies behind a structural hairline divider", () => {
    renderSplitArea({
      path: threadPath("thr-a"),
      layout: twoPaneLayout("pane-1"),
    });

    const activePane = document.querySelector<HTMLElement>(
      '[data-split-pane-id="pane-1"]',
    );
    const inactivePane = document.querySelector<HTMLElement>(
      '[data-split-pane-id="pane-2"]',
    );
    expect(activePane?.dataset.focused).toBe("true");
    expect(inactivePane?.dataset.focused).toBe("false");
    const activeScrim = activePane?.querySelector<HTMLElement>(
      ":scope > [data-pane-focus-scrim]",
    );
    const inactiveScrim = inactivePane?.querySelector<HTMLElement>(
      ":scope > [data-pane-focus-scrim]",
    );
    expect(activeScrim?.classList).toContain("bg-transparent");
    expect(inactiveScrim?.classList).toContain("pointer-events-none");
    expect(inactiveScrim?.classList).toContain("bg-background/30");
    expect(inactiveScrim?.classList).not.toContain("bg-background/20");

    const separator = screen.getByRole("separator");
    expect(separator.classList).toContain("w-px");
    expect(separator.classList).toContain("bg-border-seam");
    expect(separator.classList).not.toContain("w-1.5");
    expect(separator.firstElementChild?.classList).toContain("-inset-x-1.5");
  });

  it("uses one title tab to distinguish the focused new-thread split", async () => {
    renderSplitArea({
      path: "/",
      layout: {
        root: {
          type: "split",
          dir: "row",
          sizes: [0.5, 0.5],
          children: [
            {
              type: "pane",
              paneId: "pane-1",
              content: threadContent("thr-a"),
            },
            {
              type: "pane",
              paneId: "pane-2",
              content: newThreadContent,
            },
          ],
        },
        focusedPaneId: "pane-2",
      },
      routeContent: newThreadContent,
    });

    const newThreadPane = document.querySelector<HTMLElement>(
      '[data-split-pane-id="pane-2"]',
    );
    const newThreadHeader = newThreadPane?.querySelector("header");
    const focusedTab = newThreadHeader?.querySelector<HTMLElement>(
      "[data-pane-header-focus-tab]",
    );
    expect(focusedTab).not.toBeNull();
    expect(focusedTab?.classList).toContain("bg-muted");
    expect(focusedTab?.classList).not.toContain("shadow-sm");
    expect(screen.getByText("New thread").classList).toContain("font-normal");
    expect(screen.getByText("New thread").classList).not.toContain(
      "font-medium",
    );
    expect(newThreadHeader?.classList).not.toContain("bg-surface-raised");
    expect(newThreadHeader?.classList).not.toContain("opacity-50");
    expect(
      newThreadHeader?.querySelector('[data-icon="CloseThreadPane"]'),
    ).not.toBeNull();

    fireEvent.pointerDown(screen.getByTestId("pane-thr-a"));
    await waitFor(() => {
      expect(
        newThreadHeader?.querySelector("[data-pane-header-focus-tab]"),
      ).toBeNull();
      const inactiveTitle = screen.getByText("New thread");
      expect(inactiveTitle.classList).toContain("text-muted-foreground/60");
      expect(inactiveTitle.classList).toContain("font-normal");
      expect(inactiveTitle.classList).not.toContain("font-medium");
      expect(newThreadHeader?.classList).not.toContain("bg-surface-raised");
      expect(newThreadHeader?.classList).not.toContain("opacity-50");
    });
  });

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
    expect(screen.getByTestId("hosted-composer-scope-thr-a").textContent).toBe(
      "thr-a",
    );
    expect(screen.queryByTestId("hosted-panel-thr-b")).toBeNull();
    expect(toggle.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(toggle.querySelector("button")?.hasAttribute("aria-pressed")).toBe(
      false,
    );

    // thr-b's own persisted panel state is closed, but refocusing must swap
    // the panel's content without closing the window-level panel.
    fireEvent.pointerDown(screen.getByTestId("pane-thr-b"));
    await screen.findByTestId("hosted-panel-thr-b");
    expect(screen.getByTestId("hosted-composer-scope-thr-b").textContent).toBe(
      "thr-b",
    );
    expect(screen.queryByTestId("hosted-panel-thr-a")).toBeNull();
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");

    // An explicit toggle closes it, and the closed state also survives
    // refocusing the pane whose panel was originally open.
    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    fireEvent.pointerDown(screen.getByTestId("pane-thr-a"));
    await screen.findByTestId("hosted-panel-thr-a");
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-expanded"),
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
    expect(toggle.querySelector("button")?.getAttribute("aria-expanded")).toBe(
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
    // the empty state; the neutral disclosure toggle stays put and expanded.
    fireEvent.pointerDown(pluginPane);
    await screen.findByTestId("split-workspace-empty-panel-state");
    const emptyPanelHandle = document.getElementById(
      "split-workspace-empty-secondary-panel-handle",
    );
    expect(emptyPanelHandle?.classList).toContain("w-px");
    expect(emptyPanelHandle?.classList).toContain("bg-border-seam");
    expect(emptyPanelHandle?.classList).not.toContain("w-1.5");
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");

    // The toggle closes the window panel from the plugin pane, and the closed
    // state survives refocusing the thread pane (imposed on its persisted
    // state).
    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(
      screen
        .getByTestId("split-workspace-panel-toggle")
        .querySelector("button")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    fireEvent.pointerDown(screen.getByTestId("pane-thr-a"));
    const restoredClosedToggle = await screen.findByRole("button", {
      name: "Show right panel",
    });
    expect(restoredClosedToggle.getAttribute("aria-expanded")).toBe("false");
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

    expect(
      screen
        .getAllByTestId(/^pane-thr-/)
        .filter(
          (pane) => pane.getAttribute("data-window-top-left-owner") === "true",
        ),
    ).toEqual([screen.getByTestId("pane-thr-a")]);

    fireEvent.click(screen.getByTestId("external-nav"));

    // Focused pane (thr-b) now shows thr-c; the unfocused pane (thr-a) survives.
    expect(await screen.findByTestId("pane-thr-c")).toBeTruthy();
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.queryByTestId("pane-thr-b")).toBeNull();
    expect(
      screen
        .getAllByTestId(/^pane-thr-/)
        .filter(
          (pane) => pane.getAttribute("data-window-top-left-owner") === "true",
        ),
    ).toEqual([screen.getByTestId("pane-thr-a")]);
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

  it("reserves collapsed window-left chrome only for the structural top-left pane", async () => {
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
    sidebarState.showing = false;
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

    const contentRow = async (path: string) =>
      (await screen.findByText(path))
        .closest("header")
        ?.querySelector('[data-testid="app-page-header-content-row"]');
    expect((await contentRow("top-left"))?.className).toContain("pl-[104px]");
    for (const path of ["top-right", "bottom-left", "bottom-right"]) {
      expect((await contentRow(path))?.className).not.toContain("pl-[104px]");
    }

    fireEvent.click(
      screen.getAllByRole("button", { name: /Maximize pane/ })[3]!,
    );
    await waitFor(() =>
      expect(contentRow("bottom-right")).resolves.toHaveProperty(
        "className",
        expect.stringContaining("pl-[104px]"),
      ),
    );
    expect((await contentRow("top-left"))?.className).not.toContain(
      "pl-[104px]",
    );

    fireEvent.click(screen.getByRole("button", { name: /Restore pane/ }));
    await waitFor(() =>
      expect(contentRow("top-left")).resolves.toHaveProperty(
        "className",
        expect.stringContaining("pl-[104px]"),
      ),
    );
  });

  it("assigns exactly one top-left owner through eight-pane structural changes", async () => {
    for (const threadId of [
      "thr-c",
      "thr-d",
      "thr-e",
      "thr-f",
      "thr-g",
      "thr-h",
    ]) {
      threadStore.set(threadId, { archivedAt: null, deletedAt: null });
    }
    const initialLayout = eightPaneThreadLayout();
    const store = renderSplitArea({
      path: threadPath("thr-h"),
      layout: initialLayout,
    });
    await screen.findByTestId("pane-thr-h");

    const owners = () =>
      screen
        .getAllByTestId(/^pane-thr-/)
        .filter(
          (pane) => pane.getAttribute("data-window-top-left-owner") === "true",
        );
    expect(owners()).toHaveLength(1);
    expect(owners()[0]?.getAttribute("data-testid")).toBe("pane-thr-a");

    const moved = movePane(initialLayout, "pane-8", "pane-1", "left");
    store.set(splitLayoutAtom, moved);
    await waitFor(() => expect(owners()).toHaveLength(1));
    expect(owners()[0]?.getAttribute("data-testid")).toBe("pane-thr-h");

    fireEvent.click(screen.getByTestId("close-thr-h"));
    await waitFor(() => expect(screen.queryByTestId("pane-thr-h")).toBeNull());
    expect(owners()).toHaveLength(1);
    expect(owners()[0]?.getAttribute("data-testid")).toBe("pane-thr-a");
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
    expect(close.querySelector('[data-icon="ClosePluginPane"]')).not.toBeNull();
    expect(
      toggle.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("ignores a layout written by another tab (issue #873)", async () => {
    renderSplitArea({ path: threadPath("thr-a") });
    expect(await screen.findByTestId("pane-thr-a")).toBeTruthy();

    // Another tab selects thr-b: same-origin localStorage write plus the
    // `storage` event the browser delivers to every other tab.
    const otherTabLayout = serializeSplitLayout({
      root: { type: "pane", paneId: "pane-1", content: threadContent("thr-b") },
      focusedPaneId: "pane-1",
    });
    window.localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, otherTabLayout);
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: SPLIT_LAYOUT_STORAGE_KEY,
        newValue: otherTabLayout,
        storageArea: window.localStorage,
      }),
    );

    // This tab keeps its own thread and URL; nothing bleeds across tabs.
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        threadPath("thr-a"),
      );
    });
    expect(screen.queryAllByTestId(/^pane-/)).toHaveLength(1);
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.queryByTestId("pane-thr-b")).toBeNull();
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
