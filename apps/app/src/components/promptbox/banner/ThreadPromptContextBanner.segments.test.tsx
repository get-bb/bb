// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  ThreadPromptContextBanner,
  type CoreThreadContext,
  type ThreadPromptGitSection,
} from "./ThreadPromptContextBanner";

const changedFile = {
  path: "apps/app/src/main.ts",
  status: "M" as const,
  insertions: 2,
  deletions: 0,
};

const git: ThreadPromptGitSection = {
  changedFiles: {
    kind: "uncommitted",
    label: "Uncommitted",
    files: [changedFile],
    mergeBaseRef: null,
    stats: {
      insertions: 2,
      deletions: 0,
      lineStatsComplete: true,
      fileCount: 1,
      files: [changedFile],
    },
  },
  mergeBase: { branch: "main", options: ["main"], onChange: () => {} },
  onPromptBannerFileClick: () => {},
};

const parentThread = {
  parentThreadTitle: "Plan the release",
  href: "/threads/thr_parent",
  relationship: "parent" as const,
};

const childThreads = {
  items: [
    {
      id: "thr_child",
      title: "Run the checks",
      href: "/threads/thr_child",
      hasPendingInteraction: false,
    },
  ],
  pendingInteractions: [],
};

const EMPTY_CORE: CoreThreadContext = {
  git: null,
  gitPending: false,
  parentThread: null,
  childThreads: null,
};

const seenProps: ExperimentalThreadContextSegmentProps[] = [];

function PluginSegment(props: ExperimentalThreadContextSegmentProps) {
  seenProps.push(props);
  if (props.part === "summary") {
    return (
      <button type="button" onClick={props.onToggle}>
        Plugin summary {props.segments.map((segment) => segment.id).join(",")}
      </button>
    );
  }
  if (props.part === "action") return <span>Plugin action</span>;
  return props.isExpanded ? <p>Plugin details</p> : null;
}

function registerPluginSegment({
  visible = true,
  order = 200,
  component = PluginSegment,
  placement,
}: {
  visible?: boolean;
  order?: number;
  component?: (props: ExperimentalThreadContextSegmentProps) => ReactNode;
  placement?: "inline" | "before";
} = {}) {
  setPluginSlotRegistrations(
    "demo",
    makePluginRegistrationSet({
      threadContextSegments: [
        {
          id: "status",
          title: "Demo status",
          order,
          ...(placement ? { placement } : {}),
          component,
          useVisible: () => visible,
        },
      ],
    }),
  );
}

function renderBanner({
  core = EMPTY_CORE,
  archived = false,
  showInlineSegments = true,
  expandedSegment = null,
  onToggleSegment = () => {},
}: {
  core?: CoreThreadContext;
  archived?: boolean;
  showInlineSegments?: boolean;
  expandedSegment?: string | null;
  onToggleSegment?: (key: string) => void;
} = {}) {
  return render(
    <MemoryRouter>
      <ThreadPromptContextBanner
        input={{
          threadId: "thr_1",
          projectId: "proj_1",
          environment: { id: "env_1" },
        }}
        core={core}
        archivedSection={archived ? { archivedAt: 1 } : null}
        environmentGoneSection={null}
        showInlineSegments={showInlineSegments}
        expandedSegment={expandedSegment}
        onToggleSegment={onToggleSegment}
      />
    </MemoryRouter>,
  );
}

function rowText(): string {
  const card = screen.getByRole("region", {
    name: "Thread context before sending",
  });
  return card.firstElementChild?.textContent ?? "";
}

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("demo");
  resetAllCrashedPluginSlotsForTest();
  seenProps.length = 0;
  vi.restoreAllMocks();
});

describe("thread context segments", () => {
  it("orders plugin segments between core segments and shares the visible list", () => {
    registerPluginSegment();
    renderBanner({ core: { ...EMPTY_CORE, git, parentThread } });

    const row = rowText();
    expect(row.indexOf("Plugin summary")).toBeGreaterThan(-1);
    expect(
      screen.getByRole("button", { name: "Parent Plan the release" }),
    ).toBeTruthy();
    expect(row.indexOf("Plugin summary")).toBeLessThan(
      row.indexOf("Uncommitted"),
    );
    expect(row.indexOf("Uncommitted")).toBeLessThan(
      row.indexOf("Plugin action"),
    );
    expect(
      screen.getByText("Plugin summary parent-thread,status,changed-files"),
    ).toBeTruthy();
    expect(seenProps.at(-1)).toMatchObject({
      threadId: "thr_1",
      projectId: "proj_1",
      environment: { id: "env_1" },
    });
    expect(screen.getByRole("group", { name: "Demo status" })).toBeTruthy();
    expect(screen.queryByText("Merge base")).toBeNull();
  });

  it("leaves a hidden segment out of the row and the shared list", () => {
    registerPluginSegment({ visible: false });
    renderBanner({ core: { ...EMPTY_CORE, git } });

    expect(screen.queryByText(/Plugin summary/)).toBeNull();
    expect(screen.getByText("Merge base")).toBeTruthy();
  });

  it("expands one segment at a time through the shared key", () => {
    registerPluginSegment();
    const onToggleSegment = vi.fn();
    const { unmount } = renderBanner({
      core: { ...EMPTY_CORE, git },
      onToggleSegment,
    });
    screen.getByText(/Plugin summary/).click();
    expect(onToggleSegment).toHaveBeenCalledWith("demo/status");
    unmount();

    renderBanner({
      core: { ...EMPTY_CORE, git },
      expandedSegment: "demo/status",
    });
    expect(screen.getByText("Plugin details")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Changed files/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("drops only the crashing part of a plugin segment", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    registerPluginSegment({
      component: (props) => {
        if (props.part === "summary") throw new Error("plugin crashed");
        return props.part === "action" ? <span>Plugin action</span> : null;
      },
    });
    renderBanner({ core: { ...EMPTY_CORE, git } });

    expect(screen.getByRole("button", { name: /Changed files/ })).toBeTruthy();
    expect(screen.getByText("Plugin action")).toBeTruthy();
  });

  it("hides a segment whose visibility hook crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadContextSegments: [
          {
            id: "status",
            title: "Demo status",
            component: PluginSegment,
            useVisible: () => {
              throw new Error("visibility crashed");
            },
          },
        ],
      }),
    );
    renderBanner({ core: { ...EMPTY_CORE, git } });

    expect(screen.queryByText(/Plugin summary/)).toBeNull();
    expect(screen.getByText("Merge base")).toBeTruthy();
  });

  it("keeps plugin segments off read-only history", () => {
    registerPluginSegment();
    renderBanner({ core: { ...EMPTY_CORE, parentThread }, archived: true });

    expect(screen.getByText("Thread is archived")).toBeTruthy();
    expect(screen.queryByText(/Plugin summary/)).toBeNull();
  });

  it("shows only before cards beside a pending question", () => {
    registerPluginSegment({ placement: "before" });
    renderBanner({
      core: { ...EMPTY_CORE, childThreads, git },
      showInlineSegments: false,
    });

    expect(screen.getByRole("region", { name: "Child threads" })).toBeTruthy();
    expect(screen.getByText("Plugin summary")).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Thread context before sending" }),
    ).toBeNull();
  });

  it("withholds the inline row while core git status loads", () => {
    registerPluginSegment();
    renderBanner({
      core: { ...EMPTY_CORE, childThreads, parentThread, gitPending: true },
    });

    expect(screen.getByRole("region", { name: "Child threads" })).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Thread context before sending" }),
    ).toBeNull();
  });
});
