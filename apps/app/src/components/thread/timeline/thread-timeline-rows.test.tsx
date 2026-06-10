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
import {
  commandRow,
  conversationRow,
  delegationRow,
  fileChangeRow,
  imageViewRow,
  systemRow,
  turnRow,
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
    childOrigin: null,
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

  it("renders the fork icon only on the seed anchor, not on later cross-thread agent rows", () => {
    const view = renderTimelineRows({
      overrides: {
        threadChildOrigin: "fork",
      },
      timelineRows: [
        // The fork seed anchor: the thread-start turn (agent-initiated, no turn
        // id) rendered as "Message from {source}".
        conversationRow({
          id: "fork-seed-anchor",
          role: "user",
          initiator: "agent",
          senderThreadId: "thr_source",
          turnId: null,
          text: "Anchor agent message the fork branched from.",
          sourceSeqStart: 1,
        }),
        // A later cross-thread agent message in the same forked thread. It is
        // also agent-initiated with a sender thread, but belongs to a turn — it
        // is NOT the fork seed, so it must keep its own per-source-kind icon.
        conversationRow({
          id: "later-cross-thread-message",
          role: "user",
          initiator: "agent",
          senderThreadId: "thr_other",
          turnId: "turn-7",
          text: "Later message from another thread.",
          sourceSeqStart: 2,
        }),
      ],
    });

    const seedRow = view.container.querySelector(
      '[data-timeline-row-id="fork-seed-anchor"]',
    );
    const laterRow = view.container.querySelector(
      '[data-timeline-row-id="later-cross-thread-message"]',
    );
    if (!seedRow || !laterRow) {
      throw new Error("Expected both generated rows to render.");
    }
    // Seed anchor takes the Fork icon; the later cross-thread row keeps the
    // generic agent-message icon.
    expect(seedRow.querySelector('[data-icon="Fork"]')).toBeTruthy();
    expect(seedRow.querySelector('[data-icon="MessageSquare"]')).toBeNull();
    expect(laterRow.querySelector('[data-icon="Fork"]')).toBeNull();
    expect(
      laterRow.querySelector('[data-icon="MessageSquare"]'),
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
