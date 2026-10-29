// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  ThreadContextCardProvider,
  type CoreThreadContextCardRow,
} from "@/components/plugin/PluginThreadContextCard";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  GIT_SEGMENT_FIXTURE_PLUGIN_ID,
  GitSegmentFixtureProvider,
  gitSegmentFixtureMergeBase,
  type GitSegmentFixture,
} from "@/test/fixtures/git-segment-plugin";
import {
  ThreadPromptContextBanner,
  type CoreThreadContext,
} from "./ThreadPromptContextBanner";

const changedFile = {
  path: "apps/app/src/main.ts",
  status: "M" as const,
  insertions: 2,
  deletions: 0,
};

const git: GitSegmentFixture = {
  section: {
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
  mergeBase: gitSegmentFixtureMergeBase({ options: ["main"] }),
};

const parentThread = {
  parentThreadTitle: "Plan the release",
  href: "/threads/thr_parent",
  relationship: "parent" as const,
};

const EMPTY_CORE: CoreThreadContext = {
  parentThread: null,
};

const seenProps: ExperimentalThreadContextSegmentProps[] = [];

function PluginSummary(props: ExperimentalThreadContextSegmentProps) {
  seenProps.push(props);
  return (
    <button type="button" onClick={props.onToggle}>
      Plugin summary {props.segments.map((segment) => segment.key).join(",")}
    </button>
  );
}

function PluginAction() {
  return <span>Plugin action</span>;
}

function PluginDetails({ isExpanded }: ExperimentalThreadContextSegmentProps) {
  return isExpanded ? <p>Plugin details</p> : null;
}

function registerPluginSegment({
  visible = true,
  group = "2_pullRequest",
  summary = PluginSummary,
}: {
  visible?: boolean;
  group?: string;
  summary?: (props: ExperimentalThreadContextSegmentProps) => ReactNode;
} = {}) {
  setPluginSlotRegistrations(
    "demo",
    makePluginRegistrationSet({
      threadContextSegments: [
        {
          id: "status",
          title: "Demo status",
          group,
          summary,
          action: PluginAction,
          details: PluginDetails,
          useVisible: () => visible,
        },
      ],
    }),
  );
}

const CARD_ROWS: CoreThreadContextCardRow[] = [
  { id: "row", group: "thread", order: 10, component: () => null },
];

function renderBanner({
  core = EMPTY_CORE,
  git = null,
  archived = false,
  threadContextKind = "banner",
  expandedSegment = null,
  onToggleSegment = () => {},
}: {
  core?: CoreThreadContext;
  git?: GitSegmentFixture | null;
  archived?: boolean;
  threadContextKind?: "banner" | "card";
  expandedSegment?: string | null;
  onToggleSegment?: (key: string) => void;
} = {}) {
  return render(
    <MemoryRouter>
      <GitSegmentFixtureProvider value={git}>
        <ThreadContextCardProvider
          enabled={threadContextKind === "card"}
          coreRows={CARD_ROWS}
          coreSections={[]}
          threadId="thr_1"
          projectId="proj_1"
          environment={{ id: "env_1" }}
        >
          <ThreadPromptContextBanner
            input={{
              threadId: "thr_1",
              projectId: "proj_1",
              environment: { id: "env_1" },
            }}
            core={core}
            archivedSection={archived ? { archivedAt: 1 } : null}
            environmentGoneSection={null}
            expandedSegment={expandedSegment}
            onToggleSegment={onToggleSegment}
          />
        </ThreadContextCardProvider>
      </GitSegmentFixtureProvider>
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
  removePluginSlotRegistrations(GIT_SEGMENT_FIXTURE_PLUGIN_ID);
  resetAllCrashedPluginSlotsForTest();
  seenProps.length = 0;
  vi.restoreAllMocks();
});

describe("thread context segments", () => {
  it("leaves the parent thread to the thread context card when the view shows one", () => {
    registerPluginSegment();
    renderBanner({
      core: { ...EMPTY_CORE, parentThread },
      threadContextKind: "card",
    });

    expect(
      screen.queryByRole("button", { name: "Parent Plan the release" }),
    ).toBeNull();
    expect(screen.getByText(/Plugin summary demo\/status/)).toBeTruthy();
  });

  it("orders core and plugin segments together and shares the visible list", () => {
    registerPluginSegment();
    renderBanner({ core: { ...EMPTY_CORE, parentThread }, git });

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
      screen.getByText(
        "Plugin summary bb--core/parent-thread,demo/status,bb--git/changed-files",
      ),
    ).toBeTruthy();
    expect(seenProps.at(-1)).toMatchObject({
      threadId: "thr_1",
      projectId: "proj_1",
      environment: { id: "env_1" },
    });
    expect(screen.getByRole("group", { name: "Demo status" })).toBeTruthy();
    expect(screen.queryByText("Merge base")).toBeNull();
  });

  it("places a segment in a group of its own where that group sorts", () => {
    registerPluginSegment({ group: "9_custom" });
    renderBanner({ core: { ...EMPTY_CORE, parentThread }, git });

    expect(
      screen.getByText(
        "Plugin summary bb--core/parent-thread,bb--git/changed-files,demo/status",
      ),
    ).toBeTruthy();
  });

  it("leaves a hidden segment out of the row and the shared list", () => {
    registerPluginSegment({ visible: false });
    renderBanner({ git });

    expect(screen.queryByText(/Plugin summary/)).toBeNull();
    expect(screen.getByText("Merge base")).toBeTruthy();
  });

  it("expands one segment at a time through the shared key", () => {
    registerPluginSegment();
    const onToggleSegment = vi.fn();
    const { unmount } = renderBanner({
      git,
      onToggleSegment,
    });
    screen.getByText(/Plugin summary/).click();
    expect(onToggleSegment).toHaveBeenCalledWith("demo/status");
    unmount();

    renderBanner({
      git,
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
      summary: () => {
        throw new Error("plugin crashed");
      },
    });
    renderBanner({ git });

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
            group: "2_pullRequest",
            summary: PluginSummary,
            useVisible: () => {
              throw new Error("visibility crashed");
            },
          },
        ],
      }),
    );
    renderBanner({ git });

    expect(screen.queryByText(/Plugin summary/)).toBeNull();
    expect(screen.getByText("Merge base")).toBeTruthy();
  });

  it("keeps plugin segments off read-only history", () => {
    registerPluginSegment();
    renderBanner({ core: { ...EMPTY_CORE, parentThread }, archived: true });

    expect(screen.getByText("Thread is archived")).toBeTruthy();
    expect(screen.queryByText(/Plugin summary/)).toBeNull();
  });
});
