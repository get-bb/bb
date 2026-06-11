// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadWithRuntime } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import { BB_WORKFLOW_TASK_TYPE } from "@bb/domain";
import type { WorkflowProgressSnapshot } from "@bb/domain";
import {
  commandRow,
  conversationRow,
  delegationRow,
  fileChangeRow,
  imageViewRow,
  systemRow,
  turnRow,
  workflowRow,
} from "@/test/fixtures/thread-timeline-rows";
import {
  ThreadTimelineRows,
  type ThreadTimelineRowsProps,
} from "@/components/thread/timeline/ThreadTimelineRows";
import {
  threadQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
} from "@/hooks/queries/query-keys";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";

type ElementScrollMetricName = "clientHeight" | "scrollHeight";
type ThreadTimelineRowsPropsOverrides = Partial<
  Omit<ThreadTimelineRowsProps, "timelineRows">
>;

interface ThreadTimelineRowsFixtureArgs {
  overrides?: ThreadTimelineRowsPropsOverrides;
  seedQueryClient?: (queryClient: QueryClient) => void;
  timelineRows: TimelineRow[];
}

interface RerenderTimelineRowsArgs extends ThreadTimelineRowsFixtureArgs {
  view: RenderResult;
}

interface ThreadTimelineRowsRenderResult extends RenderResult {
  queryClient: QueryClient;
}

interface RequestUrlRef {
  current: URL | null;
}

interface ThreadWithRuntimeFixtureArgs {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
}

function threadWithRuntime({
  id,
  projectId,
  title,
  titleFallback,
}: ThreadWithRuntimeFixtureArgs): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id,
    lastReadAt: null,
    latestAttentionAt: 10,
    parentThreadId: null,
    pinnedAt: null,
    projectId,
    providerId: "provider-1",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title,
    titleFallback,
    updatedAt: 10,
  };
}

function threadTimelineRowsProps({
  overrides = {},
  timelineRows,
}: ThreadTimelineRowsFixtureArgs): ThreadTimelineRowsProps {
  return {
    threadId: "thread-1",
    threadRuntimeDisplayStatus: "idle",
    workspaceRootPath: undefined,
    ...overrides,
    timelineRows,
  };
}

function renderTimelineRows(
  args: ThreadTimelineRowsFixtureArgs,
): ThreadTimelineRowsRenderResult {
  const harness = createQueryClientTestHarness();
  args.seedQueryClient?.(harness.queryClient);
  const view = render(
    <ThreadTimelineRows {...threadTimelineRowsProps(args)} />,
    {
      wrapper: harness.wrapper,
    },
  );
  return Object.assign(view, { queryClient: harness.queryClient });
}

function rerenderTimelineRows({
  overrides,
  timelineRows,
  view,
}: RerenderTimelineRowsArgs): void {
  view.rerender(
    <ThreadTimelineRows
      {...threadTimelineRowsProps({
        overrides,
        timelineRows,
      })}
    />,
  );
}

function restoreElementScrollMetric(
  name: ElementScrollMetricName,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(HTMLElement.prototype, name, descriptor);
    return;
  }
  delete HTMLElement.prototype[name];
}

function withElementScrollMetrics(run: () => void): void {
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 100;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return 1_000;
    },
  });

  try {
    run();
  } finally {
    restoreElementScrollMetric("clientHeight", originalClientHeight);
    restoreElementScrollMetric("scrollHeight", originalScrollHeight);
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThreadTimelineRows", () => {
  it("uses cached thread detail titles for manager-originated user rows", () => {
    renderTimelineRows({
      overrides: {
        projectId: "project-1",
      },
      seedQueryClient: (queryClient) => {
        queryClient.setQueryData<ThreadWithRuntime>(
          threadQueryKey("thr_parent123"),
          threadWithRuntime({
            id: "thr_parent123",
            projectId: "project-1",
            title: "Ops manager",
            titleFallback: "Ops manager",
          }),
        );
      },
      timelineRows: [
        conversationRow({
          role: "user",
          initiator: "agent",
          senderThreadId: "thr_parent123",
          text: "Manager-to-child status update.",
        }),
      ],
    });

    expect(
      screen.getByTitle("Message from Ops manager"),
    ).toBeTruthy();
  });

  it("renders an unread divider before the first row newer than the frozen read cutoff", () => {
    renderTimelineRows({
      overrides: {
        unreadDividerPlacement: { kind: "after-cutoff", cutoffAt: 15 },
      },
      timelineRows: [
        conversationRow({
          id: "old-message",
          sourceSeqStart: 10,
          text: "Read before cutoff",
        }),
        conversationRow({
          id: "new-message",
          sourceSeqStart: 20,
          text: "Manager update after cutoff",
        }),
      ],
    });

    const divider = screen.getByRole("separator", { name: "New messages" });
    const oldMessage = screen.getByText("Read before cutoff");
    const newMessage = screen.getByText("Manager update after cutoff");
    expect(
      oldMessage.compareDocumentPosition(divider) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      divider.compareDocumentPosition(newMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("omits the unread divider when no rows are newer than the cutoff", () => {
    renderTimelineRows({
      overrides: {
        unreadDividerPlacement: { kind: "after-cutoff", cutoffAt: 20 },
      },
      timelineRows: [
        conversationRow({
          id: "read-message",
          sourceSeqStart: 20,
          text: "Read manager update",
        }),
      ],
    });

    expect(
      screen.queryByRole("separator", { name: "New messages" }),
    ).toBeNull();
  });

  it("renders delegation child progress and final output when both are present", () => {
    const view = renderTimelineRows({
      timelineRows: [delegationRow()],
    });

    expect(view.container.textContent ?? "").not.toContain(
      "Final subagent answer.",
    );

    fireEvent.click(screen.getByRole("button", { name: /Ran subagent/u }));
    expect(view.container.textContent ?? "").toContain(
      "Final subagent answer.",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Ran\s+rg timeline apps\/app/u,
      }),
    );

    expect(view.container.textContent ?? "").toContain("rg timeline apps/app");
  });

  it("renders image view rows with an expandable image preview", () => {
    const path = "/tmp/sightglass-quote-merge-check/dashboard-main.png";
    renderTimelineRows({
      timelineRows: [
        imageViewRow({
          path,
        }),
      ],
    });

    expect(screen.getByText("Viewed image:")).toBeTruthy();
    expect(screen.getByText("dashboard-main.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Viewed image:/u }));

    const previewButton = screen.getByRole("button", {
      name: "Open image preview: dashboard-main.png",
    });
    const image = previewButton.querySelector("img");
    if (!image) {
      throw new Error("Expected an image preview thumbnail.");
    }
    const imageSrc = image.getAttribute("src");
    expect(imageSrc).not.toBeNull();
    const imageUrl = new URL(imageSrc ?? "", "http://localhost");
    expect(imageUrl.pathname).toBe(
      "/api/v1/threads/thread-1/host-files/content",
    );
    expect(imageUrl.searchParams.get("path")).toBe(path);
  });

  it("shows an image view preview fallback when the image cannot load", () => {
    renderTimelineRows({
      timelineRows: [
        imageViewRow({
          path: "/tmp/sightglass-quote-merge-check/dashboard-main.png",
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Viewed image:/u }));
    const previewButton = screen.getByRole("button", {
      name: "Open image preview: dashboard-main.png",
    });
    const image = previewButton.querySelector("img");
    if (!image) {
      throw new Error("Expected an image preview thumbnail.");
    }
    fireEvent.error(image);

    expect(screen.getByText("Image preview unavailable.")).toBeTruthy();
  });

  it("retries an image view preview after a pending row completes with the same path", async () => {
    const path = "/tmp/sightglass-quote-merge-check/dashboard-main.png";
    const view = renderTimelineRows({
      overrides: {
        threadRuntimeDisplayStatus: "active",
      },
      timelineRows: [
        imageViewRow({
          durationMs: null,
          id: "image-view-1",
          path,
          sourceSeqEnd: 1,
          sourceSeqStart: 1,
          status: "pending",
        }),
      ],
    });

    const previewButton = screen.getByRole("button", {
      name: "Open image preview: dashboard-main.png",
    });
    const image = previewButton.querySelector("img");
    if (!image) {
      throw new Error("Expected an image preview thumbnail.");
    }
    fireEvent.error(image);
    expect(screen.getByText("Image preview unavailable.")).toBeTruthy();

    rerenderTimelineRows({
      overrides: {
        threadRuntimeDisplayStatus: "active",
      },
      view,
      timelineRows: [
        imageViewRow({
          durationMs: 1_000,
          id: "image-view-1",
          path,
          sourceSeqEnd: 2,
          sourceSeqStart: 1,
          status: "completed",
        }),
      ],
    });

    await waitFor(() => {
      expect(screen.queryByText("Image preview unavailable.")).toBeNull();
      const completedPreviewButton = screen.getByRole("button", {
        name: "Open image preview: dashboard-main.png",
      });
      expect(completedPreviewButton.querySelector("img")).toBeTruthy();
    });
  });

  it("preserves completed activity summary identity when work appends", () => {
    const firstCommand = commandRow({
      id: "command-1",
      command: "pnpm test",
      sourceSeqStart: 1,
    });
    const secondCommand = commandRow({
      id: "command-2",
      command: "pnpm lint",
      sourceSeqStart: 2,
    });
    const view = renderTimelineRows({
      timelineRows: [firstCommand, secondCommand],
    });

    const summaryButton = screen.getByRole("button", {
      name: /Ran 2 commands/u,
    });
    fireEvent.click(summaryButton);

    expect(summaryButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("button", { name: /Ran\s+pnpm test/u }),
    ).toBeTruthy();

    rerenderTimelineRows({
      view,
      timelineRows: [
        firstCommand,
        secondCommand,
        commandRow({
          id: "command-3",
          command: "pnpm typecheck",
          sourceSeqStart: 3,
        }),
      ],
    });

    const appendedSummaryButton = screen.getByRole("button", {
      name: /Ran 3 commands/u,
    });
    expect(appendedSummaryButton).toBe(summaryButton);
    expect(appendedSummaryButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("button", { name: /Ran\s+pnpm typecheck/u }),
    ).toBeTruthy();
  });

  it("keeps an auto-opened terminal system error expanded when a follow-up appends", () => {
    const terminalError = systemRow({
      id: "provider-rate-limit",
      detail: "Usage limit detail",
      status: "error",
      systemKind: "error",
      title: "Provider rate limit reached",
      sourceSeqStart: 1,
    });
    const view = renderTimelineRows({
      timelineRows: [terminalError],
    });

    const errorButton = screen.getByRole("button", {
      name: /Provider rate limit reached/u,
    });
    expect(errorButton.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent ?? "").toContain("Usage limit detail");

    rerenderTimelineRows({
      overrides: {
        threadRuntimeDisplayStatus: "active",
      },
      view,
      timelineRows: [
        terminalError,
        conversationRow({
          id: "follow-up",
          role: "user",
          text: "please keep going",
          sourceSeqStart: 2,
          turnRequest: { kind: "message", status: "accepted" },
        }),
      ],
    });

    const appendedErrorButton = screen.getByRole("button", {
      name: /Provider rate limit reached/u,
    });
    expect(appendedErrorButton).toBe(errorButton);
    expect(appendedErrorButton.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent ?? "").toContain("Usage limit detail");
  });

  it("keeps a manually collapsed terminal system error collapsed when a follow-up appends", () => {
    const terminalError = systemRow({
      id: "provider-rate-limit",
      detail: "Usage limit detail",
      status: "error",
      systemKind: "error",
      title: "Provider rate limit reached",
      sourceSeqStart: 1,
    });
    const view = renderTimelineRows({
      timelineRows: [terminalError],
    });

    const errorButton = screen.getByRole("button", {
      name: /Provider rate limit reached/u,
    });
    expect(errorButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(errorButton);
    expect(errorButton.getAttribute("aria-expanded")).toBe("false");

    rerenderTimelineRows({
      overrides: {
        threadRuntimeDisplayStatus: "active",
      },
      view,
      timelineRows: [
        terminalError,
        conversationRow({
          id: "follow-up",
          role: "user",
          text: "please keep going",
          sourceSeqStart: 2,
          turnRequest: { kind: "message", status: "accepted" },
        }),
      ],
    });

    const appendedErrorButton = screen.getByRole("button", {
      name: /Provider rate limit reached/u,
    });
    expect(appendedErrorButton).toBe(errorButton);
    expect(appendedErrorButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("requests lazy turn details when expanding a turn summary", async () => {
    let requestCount = 0;
    const requestUrlRef: RequestUrlRef = { current: null };
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/timeline/turn-summary-details",
        handler: (request) => {
          requestCount += 1;
          requestUrlRef.current = new URL(request.url);
          return jsonResponse({
            rows: [
              conversationRow({
                id: "turn-detail-message",
                sourceSeqStart: 11,
                text: "Loaded turn details",
              }),
            ],
          });
        },
      },
    ]);
    const view = renderTimelineRows({
      timelineRows: [turnRow()],
    });

    fireEvent.click(screen.getByRole("button"));
    expect(view.container.textContent ?? "").toContain(
      "Loading turn details...",
    );

    await waitFor(() => {
      expect(view.container.textContent ?? "").toContain("Loaded turn details");
    });
    expect(requestCount).toBe(1);
    const requestUrl = requestUrlRef.current;
    if (requestUrl === null) {
      throw new Error("Expected turn-summary detail request URL.");
    }
    expect(requestUrl.searchParams.get("turnId")).toBe("turn-1");
    expect(requestUrl.searchParams.get("sourceSeqStart")).toBe("10");
    expect(requestUrl.searchParams.get("sourceSeqEnd")).toBe("10");
  });

  it("retries lazy turn details from the error state", async () => {
    let requestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/timeline/turn-summary-details",
        handler: () => {
          requestCount += 1;
          if (requestCount === 1) {
            return jsonResponse({ message: "failed" }, { status: 500 });
          }
          return jsonResponse({
            rows: [
              conversationRow({
                id: "retry-detail-message",
                sourceSeqStart: 11,
                text: "Retried turn details",
              }),
            ],
          });
        },
      },
    ]);
    const view = renderTimelineRows({
      timelineRows: [turnRow()],
    });

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(view.container.textContent ?? "").toContain(
        "Failed to load turn details.",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(view.container.textContent ?? "").toContain(
        "Retried turn details",
      );
    });
    expect(requestCount).toBe(2);
  });

  it("reloads lazy turn details after the source sequence range changes", async () => {
    const requestedSourceSeqEnds: string[] = [];
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/timeline/turn-summary-details",
        handler: (request) => {
          const url = new URL(request.url);
          const sourceSeqEnd = url.searchParams.get("sourceSeqEnd") ?? "";
          requestedSourceSeqEnds.push(sourceSeqEnd);
          return jsonResponse({
            rows: [
              conversationRow({
                id: `seq-${sourceSeqEnd}-detail-message`,
                sourceSeqStart: 11,
                text: `Details through seq ${sourceSeqEnd}`,
              }),
            ],
          });
        },
      },
    ]);
    const view = renderTimelineRows({
      timelineRows: [turnRow()],
    });

    fireEvent.click(screen.getByRole("button", { name: /Worked for\s*4s/u }));
    await waitFor(() => {
      expect(view.container.textContent ?? "").toContain(
        "Details through seq 10",
      );
    });

    rerenderTimelineRows({
      view,
      timelineRows: [turnRow({ sourceSeqEnd: 20 })],
    });

    await waitFor(() => {
      expect(view.container.textContent ?? "").toContain(
        "Details through seq 20",
      );
    });
    expect(requestedSourceSeqEnds).toEqual(["10", "20"]);
  });

  it("updates expanded pending command output when source sequence advances", () => {
    const view = renderTimelineRows({
      timelineRows: [
        commandRow({
          id: "command-streaming-1",
          command: "pnpm test",
          output: "first chunk",
          sourceSeqEnd: 1,
          sourceSeqStart: 1,
          status: "pending",
        }),
      ],
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Running\s+pnpm test/u }),
    );

    expect(view.container.textContent ?? "").toContain("first chunk");

    rerenderTimelineRows({
      view,
      timelineRows: [
        commandRow({
          id: "command-streaming-1",
          command: "pnpm test",
          output: "second chunk",
          sourceSeqEnd: 2,
          sourceSeqStart: 1,
          status: "pending",
        }),
      ],
    });

    expect(view.container.textContent ?? "").toContain("second chunk");
    expect(view.container.textContent ?? "").not.toContain("first chunk");
  });

  it("renders file-change stderr without rendering stdout below diffs", () => {
    const view = renderTimelineRows({
      timelineRows: [
        fileChangeRow({
          stdout: "Success. Updated the following files:\nM src/app.ts",
          stderr: "patch failed",
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Edited\s+app\.ts/u }));

    expect(view.container.textContent ?? "").not.toContain(
      "Success. Updated the following files:",
    );
    expect(view.container.textContent ?? "").toContain("patch failed");
  });

  it("collapses lazy turn-detail trailing work into a step-summary", () => {
    // Lazy turn-detail children belong to a completed turn. Its closure
    // depends on the end-of-input flush taking the closed-scope branch.
    // Without that flag, mixed-concept trailing work renders as a
    // sequence of bundles and leaves instead of one step-summary,
    // exactly the bug seen on the live timeline. See `timeline-view.ts`
    // `closeOpenStepAtBoundary` vs `flushOpenStepAsBundles`.
    const view = renderTimelineRows({
      timelineRows: [turnRow()],
    });
    view.queryClient.setQueryData(
      threadTimelineTurnSummaryDetailsQueryKey({
        sourceSeqEnd: 10,
        sourceSeqStart: 10,
        threadId: "thread-1",
        turnId: "turn-1",
      }),
      {
        rows: [
          commandRow({
            id: "nested-tool-1",
            command: "rg pattern",
            sourceSeqStart: 11,
          }),
          commandRow({
            id: "nested-tool-2",
            command: "pnpm test",
            sourceSeqStart: 12,
          }),
          fileChangeRow({
            id: "nested-edit-1",
            path: "src/a.ts",
            sourceSeqStart: 13,
          }),
          fileChangeRow({
            id: "nested-edit-2",
            path: "src/b.ts",
            sourceSeqStart: 14,
          }),
          commandRow({
            id: "nested-tool-3",
            command: "pnpm typecheck",
            sourceSeqStart: 15,
          }),
          fileChangeRow({
            id: "nested-edit-3",
            path: "src/c.ts",
            sourceSeqStart: 16,
          }),
        ],
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /Worked for\s*4s/u }));

    // Mixed-concept trailing run (commands + file edits) collapses into
    // a single step-summary describing the combined work, not separate
    // bundles per consecutive same-concept run.
    const stepSummary = screen.getByRole("button", {
      name: /Ran 3 commands, edited 3 files/u,
    });
    expect(stepSummary).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Edited 2 files\b/u }),
    ).toBeNull();
  });

  describe("workflow rows", () => {
    const PUBLIC_HAIKU_MODEL = "claude-haiku-4-5-20251001";

    const settledTreeSnapshot: WorkflowProgressSnapshot = {
      phases: [{ index: 1, title: "Scan" }],
      agents: [
        {
          index: 1,
          label: "alpha",
          state: "done",
          model: PUBLIC_HAIKU_MODEL,
          attempt: 1,
          cached: false,
          lastProgressAt: 1_000,
          phaseIndex: 1,
          tokens: 8_886,
          durationMs: 1_358,
        },
        {
          index: 2,
          label: "bravo",
          state: "done",
          model: PUBLIC_HAIKU_MODEL,
          attempt: 1,
          cached: false,
          lastProgressAt: 1_100,
          phaseIndex: 1,
          tokens: 4_200,
          durationMs: 2_000,
        },
      ],
    };

    const liveTreeSnapshot: WorkflowProgressSnapshot = {
      phases: settledTreeSnapshot.phases,
      agents: [
        settledTreeSnapshot.agents[0]!,
        {
          index: 2,
          label: "bravo",
          state: "running",
          model: PUBLIC_HAIKU_MODEL,
          attempt: 1,
          cached: false,
          lastProgressAt: 1_100,
          phaseIndex: 1,
        },
      ],
    };

    it("renders the local workflow agent tree without a run-page link", () => {
      const view = renderTimelineRows({
        timelineRows: [
          workflowRow({
            workflow: settledTreeSnapshot,
            workflowName: "fixture-mini",
          }),
        ],
      });

      fireEvent.click(
        screen.getByRole("button", { name: /Ran workflow:\s+fixture-mini/u }),
      );

      // The shared agent tree renders the phase header, progress, and stats.
      expect(screen.getByText("Scan")).toBeTruthy();
      expect(screen.getByText("2/2")).toBeTruthy();
      expect(screen.getByText("alpha")).toBeTruthy();
      expect(screen.getByText("haiku · 8.9k tok · 1s")).toBeTruthy();
      // Provider-native local workflows have no run page: the title must
      // not render any anchor.
      expect(view.container.querySelector("a")).toBeNull();
    });

    it("links the bb workflow run title to the run page deep link", () => {
      renderTimelineRows({
        overrides: { threadRuntimeDisplayStatus: "active" },
        timelineRows: [
          workflowRow({
            itemId: "wfr_run123",
            status: "pending",
            taskStatus: "running",
            taskType: BB_WORKFLOW_TASK_TYPE,
            workflow: liveTreeSnapshot,
            workflowName: "release-checks",
          }),
        ],
      });

      const link = screen.getByRole("link", { name: "release-checks" });
      expect(link.getAttribute("href")).toBe("/workflows/runs/wfr_run123");
    });

    it("keeps local workflow titles plain even when itemId looks like a run id", () => {
      // The deep link is gated on taskType, not on the itemId shape.
      renderTimelineRows({
        timelineRows: [
          workflowRow({
            itemId: "wfr_run123",
            workflow: settledTreeSnapshot,
            workflowName: "fixture-mini",
          }),
        ],
      });

      expect(screen.queryByRole("link")).toBeNull();
    });

    it("renders paused bb workflow runs distinctly with paused (not stopped) agents", () => {
      const view = renderTimelineRows({
        timelineRows: [
          workflowRow({
            itemId: "wfr_run123",
            status: "pending",
            taskStatus: "paused",
            taskType: BB_WORKFLOW_TASK_TYPE,
            workflow: liveTreeSnapshot,
            workflowName: "release-checks",
          }),
        ],
      });

      fireEvent.click(
        screen.getByRole("button", { name: /Paused workflow/u }),
      );

      expect(screen.getByText("haiku · paused")).toBeTruthy();
      expect(view.container.textContent ?? "").not.toContain("stopped");
    });

    it("renders leftover agents of an interrupted workflow as stopped", () => {
      renderTimelineRows({
        timelineRows: [
          workflowRow({
            status: "interrupted",
            taskStatus: "stopped",
            workflow: liveTreeSnapshot,
            workflowName: "fixture-mini",
          }),
        ],
      });

      fireEvent.click(
        screen.getByRole("button", { name: /Interrupted workflow/u }),
      );

      expect(screen.getByText("haiku · stopped")).toBeTruthy();
    });

    it("re-renders the expanded body when only agent.cached flips (render signature)", () => {
      // Resume flips `cached` on journal-replayed agents without moving any
      // other signature field — the `agent.cached` entry in
      // timelineRowSignatures.ts exists precisely so memoized rows do not
      // render stale. Deleting that entry must fail this test.
      const view = renderTimelineRows({
        timelineRows: [
          workflowRow({
            itemId: "wfr_run123",
            status: "pending",
            taskStatus: "running",
            taskType: BB_WORKFLOW_TASK_TYPE,
            workflow: liveTreeSnapshot,
            workflowName: "release-checks",
          }),
        ],
      });

      fireEvent.click(
        screen.getByRole("button", { name: /Running workflow/u }),
      );
      expect(screen.queryByText(/cached/u)).toBeNull();

      const cachedSnapshot: WorkflowProgressSnapshot = {
        phases: liveTreeSnapshot.phases,
        agents: [
          { ...liveTreeSnapshot.agents[0]!, cached: true },
          liveTreeSnapshot.agents[1]!,
        ],
      };
      rerenderTimelineRows({
        view,
        timelineRows: [
          workflowRow({
            itemId: "wfr_run123",
            status: "pending",
            taskStatus: "running",
            taskType: BB_WORKFLOW_TASK_TYPE,
            workflow: cachedSnapshot,
            workflowName: "release-checks",
          }),
        ],
      });

      expect(screen.getByText("haiku · 8.9k tok · 1s · cached")).toBeTruthy();
    });

    it("re-renders the expanded body when only taskStatus flips to paused (render signature)", () => {
      // Pause keeps item status "pending" (a paused run is resumable), so
      // taskStatus is the ONLY signature field that moves — the
      // `row.taskStatus` entry in timelineRowSignatures.ts exists so the
      // expanded tree re-renders paused. Deleting that entry must fail this
      // test.
      const view = renderTimelineRows({
        timelineRows: [
          workflowRow({
            itemId: "wfr_run123",
            status: "pending",
            taskStatus: "running",
            taskType: BB_WORKFLOW_TASK_TYPE,
            workflow: liveTreeSnapshot,
            workflowName: "release-checks",
          }),
        ],
      });

      fireEvent.click(
        screen.getByRole("button", { name: /Running workflow/u }),
      );
      expect(screen.queryByText(/paused/u)).toBeNull();

      rerenderTimelineRows({
        view,
        timelineRows: [
          workflowRow({
            itemId: "wfr_run123",
            status: "pending",
            taskStatus: "paused",
            taskType: BB_WORKFLOW_TASK_TYPE,
            workflow: liveTreeSnapshot,
            workflowName: "release-checks",
          }),
        ],
      });

      expect(
        screen.getByRole("button", { name: /Paused workflow/u }),
      ).toBeTruthy();
      expect(screen.getByText("haiku · paused")).toBeTruthy();
    });

    it("falls back to the terminal summary when no progress snapshot exists", () => {
      const view = renderTimelineRows({
        timelineRows: [
          workflowRow({
            summary: "Dynamic workflow completed without progress records",
            workflow: null,
            workflowName: "fixture-mini",
          }),
        ],
      });

      fireEvent.click(
        screen.getByRole("button", { name: /Ran workflow/u }),
      );

      expect(view.container.textContent ?? "").toContain(
        "Dynamic workflow completed without progress records",
      );
    });
  });

  it("keeps expanded system details pinned to bottom on streaming updates unless the user scrolls up", () => {
    // Sticky-bottom only fires while the row is still pending — completed
    // system rows preserve whatever scroll position the user landed on.
    withElementScrollMetrics(() => {
      const view = renderTimelineRows({
        timelineRows: [
          systemRow({ detail: "first\nsecond", status: "pending" }),
        ],
      });

      fireEvent.click(
        screen.getByRole("button", { name: /Provisioned thread/u }),
      );
      const scrollArea = view.container.querySelector<HTMLElement>(
        "[data-detail-scroll-area]",
      );
      expect(scrollArea?.scrollTop).toBe(900);

      if (!scrollArea) {
        throw new Error("Expected system detail scroll area to render");
      }

      scrollArea.scrollTop = 500;
      fireEvent.scroll(scrollArea);
      rerenderTimelineRows({
        view,
        timelineRows: [
          systemRow({ detail: "first\nsecond\nthird", status: "pending" }),
        ],
      });
      expect(scrollArea.scrollTop).toBe(900);

      scrollArea.scrollTop = 500;
      fireEvent.wheel(scrollArea);
      fireEvent.scroll(scrollArea);
      rerenderTimelineRows({
        view,
        timelineRows: [
          systemRow({
            detail: "first\nsecond\nthird\nfourth",
            status: "pending",
          }),
        ],
      });
      expect(scrollArea.scrollTop).toBe(500);
    });
  });
});
