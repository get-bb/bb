// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { useContext } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { SPLIT_LAYOUT_STORAGE_KEY } from "@/lib/split-layout";
import type { PaneContent, SplitLayout } from "@/lib/split-layout";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PaneContext } from "./PaneContext";
import { SplitThreadArea } from "./SplitThreadArea";

// Per-thread archived/deleted state consulted by the mocked useThread, driving
// PaneStaleWatcher. Unknown threads read as "still loading" (never pruned).
const threadStore = vi.hoisted(
  () =>
    new Map<string, { archivedAt: number | null; deletedAt: number | null }>(),
);
const experimentState = vi.hoisted(() => ({ enabled: true }));

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
  useIndexedAppCommandHandlers: () => undefined,
}));

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

const docsContent: PaneContent = {
  kind: "plugin-panel",
  pluginId: "docs",
  panelPath: "docs",
  subPath: "",
};

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

function renderSplitArea(options: {
  path: string;
  layout?: SplitLayout;
  externalTo?: string;
  routeContent?: PaneContent;
}) {
  const store = createStore();
  if (options.layout !== undefined) {
    store.set(splitLayoutAtom, options.layout);
  }
  render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[options.path]}>
          <SplitThreadArea routeContent={options.routeContent} />
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
