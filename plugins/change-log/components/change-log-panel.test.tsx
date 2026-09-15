// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installTestPluginRuntime,
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();
const app = await loadPluginApp(() => import("../app"));
const { ChangeLogPanel } = await import("./change-log-panel.js");

afterEach(cleanup);

const THREAD_ID = "thr_100000000000000000000001";
const ENV_ID = "env_1000000000000000000000001";
const NOW = 1_700_000_000_000;

interface ResultOverrides {
  entries?: unknown[];
  hasOlder?: boolean;
  olderCursor?: { anchorId: string; anchorSeq: number } | null;
  truncated?: boolean;
}

function changeEntry(args: {
  added: number;
  createdAt: number;
  path: string;
  removed: number;
  rowId: string;
}) {
  return {
    rowId: args.rowId,
    threadId: THREAD_ID,
    turnId: "turn-1",
    seqStart: 1,
    seqEnd: 2,
    createdAt: args.createdAt,
    path: args.path,
    movePath: null,
    action: "edited",
    status: "completed",
    approvalStatus: null,
    added: args.added,
    removed: args.removed,
    edits: 1,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    patchTruncated: false,
    nestedThreadId: null,
  };
}

function makeResult(overrides: ResultOverrides = {}) {
  return {
    thread: {
      id: THREAD_ID,
      title: "Fix the flaky test",
      environmentId: ENV_ID,
    },
    entries: overrides.entries ?? [
      changeEntry({
        rowId: "change_1",
        createdAt: NOW - 30_000,
        path: "src/a.ts",
        added: 3,
        removed: 1,
      }),
      changeEntry({
        rowId: "change_2",
        createdAt: NOW - 20_000,
        path: "src/b.ts",
        added: 4,
        removed: 2,
      }),
    ],
    turns: [
      {
        turnId: "turn-1",
        startedAt: NOW - 60_000,
        completedAt: NOW - 1_000,
        durationMs: 59_000,
        status: "completed",
        promptExcerpt: "Make it work",
      },
    ],
    files: [],
    totals: { changes: 2, files: 2, added: 7, removed: 3, edits: 2 },
    page: {
      hasOlder: overrides.hasOlder ?? false,
      olderCursor: overrides.olderCursor ?? null,
    },
    truncated: overrides.truncated ?? false,
  };
}

const openFilePreview = vi.fn(() => true);

function renderPanel(
  handler: (input: unknown) => unknown,
  options: { threadId?: string } = {},
) {
  return renderSlot(
    { component: ChangeLogPanel },
    { threadId: options.threadId ?? THREAD_ID, params: null },
    { rpc: { listChanges: handler }, openFilePreview },
  );
}

describe("Change Log panel", () => {
  it("registers as a thread panel action titled Changes with the Clock icon", () => {
    const action = app.threadPanelActions.find(
      (entry) => entry.id === "change-log",
    );
    expect(action).toBeDefined();
    expect(action!.title).toBe("Changes");
    expect(action!.icon).toBe("Clock");
    expect(action!.layout).toBe("flush");
  });

  it("groups changes by turn and reveals the patch on click", async () => {
    renderPanel(async () => makeResult());
    expect(await screen.findByText(/Turn 1/)).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.queryByTestId("bb-diff")).toBeNull();

    fireEvent.click(screen.getByText("src/a.ts"));
    const diff = await screen.findByTestId("bb-diff");
    expect(diff.getAttribute("data-path")).toBe("src/a.ts");
    expect(diff.textContent).toContain("@@ -1 +1 @@");
  });

  it("regroups by file and hides the turn header", async () => {
    renderPanel(async () => makeResult());
    expect(await screen.findByText(/Turn 1/)).toBeTruthy();
    fireEvent.click(screen.getByText("By file"));
    await waitFor(() => {
      expect(screen.queryByText(/Turn 1/)).toBeNull();
    });
  });

  it("filters entries by path", async () => {
    renderPanel(async () => makeResult());
    await screen.findByText("src/a.ts");
    fireEvent.change(screen.getByPlaceholderText("Filter by path"), {
      target: { value: "b.ts" },
    });
    await waitFor(() => {
      expect(screen.queryByText("src/a.ts")).toBeNull();
    });
    expect(screen.getByText("src/b.ts")).toBeTruthy();
  });

  it("shows an empty state when the thread has no changes", async () => {
    renderPanel(async () => makeResult({ entries: [] }));
    expect(
      await screen.findByText("This thread has not changed any files yet."),
    ).toBeTruthy();
  });

  it("shows an error state with a working retry", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeline read failed"))
      .mockResolvedValue(makeResult());
    renderPanel(handler);
    expect(await screen.findByText("timeline read failed")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("src/a.ts")).toBeTruthy();
  });

  it("refetches when a realtime signal arrives for this thread", async () => {
    const handler = vi.fn(async () => makeResult());
    const rendered = renderPanel(handler);
    await screen.findByText("src/a.ts");
    const before = handler.mock.calls.length;
    await rendered.emitRealtime("change-log", { threadId: THREAD_ID });
    await waitFor(() => {
      expect(handler.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("ignores realtime signals for another thread", async () => {
    const handler = vi.fn(async () => makeResult());
    const rendered = renderPanel(handler);
    await screen.findByText("src/a.ts");
    const before = handler.mock.calls.length;
    await rendered.emitRealtime("change-log", { threadId: "thr_other" });
    expect(handler.mock.calls.length).toBe(before);
  });

  it("loads older changes through the page cursor", async () => {
    const handler = vi.fn(async (input: unknown) => {
      const cursor = input as { beforeAnchorSeq?: number };
      if (cursor.beforeAnchorSeq !== undefined) {
        return makeResult({
          entries: [
            changeEntry({
              rowId: "change_old",
              createdAt: NOW - 300_000,
              path: "src/old.ts",
              added: 1,
              removed: 1,
            }),
          ],
        });
      }
      return makeResult({
        hasOlder: true,
        olderCursor: { anchorSeq: 7, anchorId: "row_7" },
      });
    });
    renderPanel(handler);
    await screen.findByText("src/a.ts");
    fireEvent.click(screen.getByText("Load older changes"));
    expect(await screen.findByText("src/old.ts")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(handler).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      beforeAnchorSeq: 7,
      beforeAnchorId: "row_7",
    });
  });

  it("opens a workspace file from an expanded change", async () => {
    renderPanel(async () => makeResult());
    await screen.findByText("src/a.ts");
    fireEvent.click(screen.getByText("src/a.ts"));
    fireEvent.click(await screen.findByText("Open file"));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: { kind: "workspace", environmentId: ENV_ID, path: "src/a.ts" },
      location: null,
    });
  });

  it("hides Open file for a path outside the workspace root", async () => {
    renderPanel(async () =>
      makeResult({
        entries: [
          changeEntry({
            rowId: "change_abs",
            createdAt: NOW - 1_000,
            path: "C:/outside/a.ts",
            added: 1,
            removed: 0,
          }),
        ],
      }),
    );
    await screen.findByText(/outside/);
    fireEvent.click(screen.getByText(/outside/));
    await screen.findByTestId("bb-diff");
    expect(screen.queryByText("Open file")).toBeNull();
  });
});
