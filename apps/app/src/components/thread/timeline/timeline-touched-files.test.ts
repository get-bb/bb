// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import type { TimelineRow } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { resolveTouchedLocalFileHref } from "@/components/ui/markdown-local-file-link";
import {
  conversationRow,
  delegationRow,
  fileChangeRow,
  fileReadRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import {
  collectTimelineTouchedFilePaths,
  useMessageTouchedFiles,
  useTimelineTouchedFilesStore,
} from "./timeline-touched-files.js";

const clone = "/home/dev/fork-work/link-probe";

const rows: TimelineRow[] = [
  fileChangeRow({ id: "edit-1", path: "src/app.ts" }),
  turnRow({
    id: "turn-1",
    experimental_touchedFilePaths: [`${clone}/plugins/rows/ProbeRow.tsx`],
  }),
  delegationRow({
    id: "delegation-1",
    childRows: [fileReadRow({ id: "read-1", path: `${clone}/docs/notes.md` })],
  }),
];

describe("timeline touched files", () => {
  it("collects live, collapsed and delegated work against the workspace root", () => {
    expect(collectTimelineTouchedFilePaths(rows, "/workspace")).toEqual([
      `${clone}/docs/notes.md`,
      `${clone}/plugins/rows/ProbeRow.tsx`,
      "/workspace/src/app.ts",
    ]);
  });

  it("drops files the work deleted or renamed after touching them", () => {
    expect(
      collectTimelineTouchedFilePaths(
        [
          turnRow({
            id: "turn-1",
            experimental_touchedFilePaths: [
              "/workspace/src/old.ts",
              "/workspace/src/gone.ts",
            ],
          }),
          fileChangeRow({
            id: "rename",
            kind: "update",
            movePath: "src/new.ts",
            path: "src/old.ts",
          }),
          fileChangeRow({ id: "delete", kind: "delete", path: "src/gone.ts" }),
        ],
        "/workspace",
      ),
    ).toEqual(["/workspace/src/new.ts"]);
  });

  it("resolves workspace-relative changes against the workspace root", () => {
    const { result } = renderHook(() =>
      useTimelineTouchedFilesStore(rows, "/workspace"),
    );
    const touchedFiles = result.current.getSnapshot();

    expect(
      ["app.ts", "ProbeRow.tsx", "docs/notes.md:3"].map((href) =>
        touchedFiles === undefined
          ? null
          : resolveTouchedLocalFileHref({ href, touchedFiles }),
      ),
    ).toEqual([
      "/workspace/src/app.ts",
      `${clone}/plugins/rows/ProbeRow.tsx`,
      `${clone}/docs/notes.md:3`,
    ]);
  });

  it("notifies its subscribers only when new rows touch a new file", () => {
    const { result, rerender } = renderHook(
      ({ timelineRows }) =>
        useTimelineTouchedFilesStore(timelineRows, "/workspace"),
      { initialProps: { timelineRows: rows } },
    );
    const store = result.current;
    const initial = store.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    rerender({
      timelineRows: [
        ...rows,
        conversationRow({ id: "reply-1", text: "Done." }),
      ],
    });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(initial);

    rerender({
      timelineRows: [
        ...rows,
        fileReadRow({ id: "read-2", path: `${clone}/README.md` }),
      ],
    });
    expect(result.current).toBe(store);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(initial);
    unsubscribe();
  });

  it("gives a message new touched files only when a file it names resolves differently", () => {
    const touchedRows = (paths: string[]) => [
      turnRow({ id: "turn-1", experimental_touchedFilePaths: paths }),
    ];
    const { result, rerender } = renderHook(
      ({ timelineRows }) =>
        useMessageTouchedFiles(
          "Created `ProbeRow.tsx`; see [the notes](docs/notes.md#L3).",
          useTimelineTouchedFilesStore(timelineRows, "/workspace"),
        ),
      {
        initialProps: {
          timelineRows: touchedRows([
            `${clone}/plugins/rows/ProbeRow.tsx`,
            `${clone}/docs/notes.md`,
          ]),
        },
      },
    );
    const initial = result.current;
    expect(
      ["ProbeRow.tsx", "docs/notes.md#L3", "app.ts"].map((href) =>
        initial === undefined
          ? null
          : resolveTouchedLocalFileHref({ href, touchedFiles: initial }),
      ),
    ).toEqual([
      `${clone}/plugins/rows/ProbeRow.tsx`,
      `${clone}/docs/notes.md#L3`,
      null,
    ]);

    rerender({
      timelineRows: touchedRows([
        `${clone}/plugins/rows/ProbeRow.tsx`,
        `${clone}/docs/notes.md`,
        "src/app.ts",
      ]),
    });
    expect(result.current).toBe(initial);

    rerender({
      timelineRows: touchedRows([
        `${clone}/plugins/rows/ProbeRow.tsx`,
        `${clone}/docs/notes.md`,
        "/workspace/plugins/rows/ProbeRow.tsx",
      ]),
    });
    expect(result.current).not.toBe(initial);
    expect(
      result.current === undefined
        ? null
        : resolveTouchedLocalFileHref({
            href: "ProbeRow.tsx",
            touchedFiles: result.current,
          }),
    ).toBeNull();
  });
});
