import { describe, expect, it } from "vitest";
import {
  deserializeSplitLayout,
  serializeSplitLayout,
  SPLIT_LAYOUT_SCHEMA_VERSION,
} from "./persistence";
import type { SplitLayout } from "./types";

const layout: SplitLayout = {
  root: {
    type: "split",
    dir: "row",
    sizes: [0.4, 0.6],
    children: [
      {
        type: "pane",
        paneId: "pane-1",
        content: {
          kind: "thread",
          projectId: "project-1",
          threadId: "thread-1",
        },
      },
      {
        type: "pane",
        paneId: "pane-2",
        content: {
          kind: "thread",
          projectId: "project-2",
          threadId: "thread-2",
        },
      },
    ],
  },
  focusedPaneId: "pane-2",
};

describe("split layout persistence", () => {
  it("round-trips a versioned split layout", () => {
    const serialized = serializeSplitLayout(layout);

    expect(JSON.parse(serialized)).toMatchObject({
      version: SPLIT_LAYOUT_SCHEMA_VERSION,
    });
    expect(deserializeSplitLayout(serialized)).toEqual(layout);
  });

  it("round-trips mixed new-thread and plugin panel content", () => {
    const mixed: SplitLayout = {
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            type: "pane",
            paneId: "pane-1",
            content: { kind: "new-thread" },
          },
          {
            type: "pane",
            paneId: "pane-2",
            content: {
              kind: "plugin-panel",
              pluginId: "notes",
              panelPath: "notes",
              subPath: "work/today.md",
            },
          },
        ],
      },
      focusedPaneId: "pane-2",
    };

    expect(deserializeSplitLayout(serializeSplitLayout(mixed))).toEqual(mixed);
  });

  it("rejects malformed JSON, unknown versions, and invalid layout invariants", () => {
    expect(deserializeSplitLayout(null)).toBeNull();
    expect(deserializeSplitLayout("not json")).toBeNull();
    expect(
      deserializeSplitLayout(JSON.stringify({ version: 999, layout })),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: {
            ...layout,
            root: { ...layout.root, sizes: [0.4, 0.4] },
          },
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: { ...layout, focusedPaneId: "missing" },
        }),
      ),
    ).toBeNull();
  });
});
