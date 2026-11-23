// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  ThreadContextCard,
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
import { seedRelatedThread } from "@/test/fixtures/related-threads";
import { ThreadPromptContextBanner } from "./ThreadPromptContextBanner";

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

function createQueryClient(parent: boolean): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  if (parent) {
    seedRelatedThread(queryClient, {
      threadId: "thr_1",
      projectId: "proj_1",
      related: {
        id: "thr_parent",
        title: "Plan the release",
        relationship: "parent",
      },
    });
  }
  return queryClient;
}

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

interface BannerOptions {
  parent?: boolean;
  git?: GitSegmentFixture | null;
  archived?: boolean;
  threadContextKind?: "banner" | "card";
}

function renderBanner({
  expandedSegment = null,
  onToggleSegment = () => {},
  ...options
}: BannerOptions & {
  expandedSegment?: string | null;
  onToggleSegment?: (key: string) => void;
} = {}) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1600);
  return render(
    <BannerTree
      {...options}
      queryClient={createQueryClient(options.parent ?? false)}
      expandedSegment={expandedSegment}
      onToggleSegment={onToggleSegment}
    />,
  );
}

function StatefulBanner(props: BannerOptions & { queryClient: QueryClient }) {
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);
  return (
    <>
      <textarea aria-label="Composer" />
      <BannerTree
        {...props}
        expandedSegment={expandedSegment}
        onToggleSegment={(key) =>
          setExpandedSegment((current) => (current === key ? null : key))
        }
      />
    </>
  );
}

function renderStatefulBanner(options: BannerOptions) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1600);
  return render(
    <StatefulBanner
      {...options}
      queryClient={createQueryClient(options.parent ?? false)}
    />,
  );
}

function BannerTree({
  queryClient,
  git = null,
  archived = false,
  threadContextKind = "banner",
  expandedSegment,
  onToggleSegment,
}: BannerOptions & {
  queryClient: QueryClient;
  expandedSegment: string | null;
  onToggleSegment: (key: string) => void;
}) {
  return (
    <QueryClientProvider client={queryClient}>
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
            <div data-scroll-overlay="">
              <ThreadContextCard />
            </div>
            <ThreadPromptContextBanner
              input={{
                threadId: "thr_1",
                projectId: "proj_1",
                environment: { id: "env_1" },
              }}
              archivedSection={archived ? { archivedAt: 1 } : null}
              environmentGoneSection={null}
              expandedSegment={expandedSegment}
              onToggleSegment={onToggleSegment}
            />
          </ThreadContextCardProvider>
        </GitSegmentFixtureProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function FocusSummary({
  isExpanded,
  onToggle,
  toggleRef,
}: ExperimentalThreadContextSegmentProps) {
  return (
    <button
      ref={toggleRef}
      type="button"
      aria-expanded={isExpanded}
      onClick={onToggle}
    >
      Demo toggle
    </button>
  );
}

function FocusDetails({
  isExpanded,
  onToggle,
  collapseRef,
}: ExperimentalThreadContextSegmentProps) {
  return isExpanded ? (
    <button ref={collapseRef} type="button" onClick={onToggle}>
      Collapse demo
    </button>
  ) : null;
}

function registerFocusSegment() {
  setPluginSlotRegistrations(
    "demo",
    makePluginRegistrationSet({
      threadContextSegments: [
        {
          id: "status",
          title: "Demo status",
          group: "2_pullRequest",
          summary: FocusSummary,
          details: FocusDetails,
        },
      ],
    }),
  );
}

async function press(button: HTMLElement) {
  await act(async () => {
    button.click();
  });
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
      parent: true,
      threadContextKind: "card",
    });

    expect(
      screen.queryByRole("button", { name: "Parent Plan the release" }),
    ).toBeNull();
    expect(screen.getByText(/Plugin summary demo\/status/)).toBeTruthy();
  });

  it("orders core and plugin segments together and shares the visible list", () => {
    registerPluginSegment();
    renderBanner({ parent: true, git });

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
    renderBanner({ parent: true, git });

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

  describe.each([
    {
      segment: "core's parent thread",
      options: { parent: true, git },
      register: () => {},
      toggle: "Parent Plan the release",
      collapse: "Collapse parent thread",
    },
    {
      segment: "read-only history's parent thread",
      options: { parent: true, archived: true },
      register: () => {},
      toggle: "Parent Plan the release",
      collapse: "Collapse parent thread",
    },
    {
      segment: "the Git plugin's changed files",
      options: { git },
      register: () => {},
      toggle: /Changed files/,
      collapse: "Collapse changed files",
    },
    {
      segment: "a plugin segment that attaches both refs",
      options: {},
      register: registerFocusSegment,
      toggle: "Demo toggle",
      collapse: "Collapse demo",
    },
  ])(
    "focus handoff for $segment",
    ({ options, register, toggle, collapse }) => {
      it("moves focus to the collapse control on expand and back on collapse", async () => {
        register();
        renderStatefulBanner(options);
        const toggleButton = screen.getByRole("button", { name: toggle });
        toggleButton.focus();
        await press(toggleButton);
        const collapseButton = screen.getByRole("button", { name: collapse });
        expect(document.activeElement).toBe(collapseButton);

        await press(collapseButton);
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: toggle }),
        );
      });

      it("leaves focus outside the segment where it is", async () => {
        register();
        renderStatefulBanner(options);
        const composer = screen.getByRole("textbox", { name: "Composer" });
        composer.focus();
        await press(screen.getByRole("button", { name: toggle }));
        expect(
          screen.getByRole("button", { name: collapse }).closest("[inert]"),
        ).toBeNull();
        expect(document.activeElement).toBe(composer);
      });
    },
  );

  it("keeps focus on a plugin's own toggle when it attaches no refs", async () => {
    registerPluginSegment();
    renderStatefulBanner({ git });
    const summary = screen.getByRole("button", { name: /Plugin summary/ });
    summary.focus();
    await press(summary);
    expect(screen.getByText("Plugin details")).toBeTruthy();
    expect(document.activeElement).toBe(summary);
  });

  it("keeps plugin segments off read-only history", () => {
    registerPluginSegment();
    renderBanner({ parent: true, archived: true });

    expect(screen.getByText("Thread is archived")).toBeTruthy();
    expect(screen.queryByText(/Plugin summary/)).toBeNull();
  });
});
