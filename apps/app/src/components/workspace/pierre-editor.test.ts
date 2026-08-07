import type { EditorOptions } from "@pierre/diffs/edit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const editorMock = vi.hoisted(() => {
  class Editor {
    canUndo = false;
    readonly options: EditorOptions<undefined>;

    constructor(options: EditorOptions<undefined>) {
      this.options = options;
    }

    cleanUp = vi.fn();

    recordEdit() {
      this.canUndo = true;
    }

    undo() {
      this.canUndo = false;
    }
  }

  return { Editor };
});

vi.mock("@pierre/diffs/edit", () => editorMock);

import { createWorkspaceEditorSession } from "./pierre-editor";

describe("createWorkspaceEditorSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps editor and dirty state separate for each file tab", () => {
    const first = createWorkspaceEditorSession({
      initialContents: "first",
      path: "src/first.ts",
    });
    const second = createWorkspaceEditorSession({
      initialContents: "second",
      path: "src/second.ts",
    });

    expect(first.editor).not.toBe(second.editor);
    expect(first.getSnapshot()).toEqual({
      contents: "first",
      dirty: false,
      path: "src/first.ts",
    });
    expect(second.getSnapshot().dirty).toBe(false);

    first.recordContents("first changed");
    (
      first.editor as unknown as InstanceType<typeof editorMock.Editor>
    ).recordEdit();

    expect(first.getSnapshot().dirty).toBe(true);
    expect(
      (first.editor as unknown as InstanceType<typeof editorMock.Editor>)
        .canUndo,
    ).toBe(true);
    expect(
      (second.editor as unknown as InstanceType<typeof editorMock.Editor>)
        .canUndo,
    ).toBe(false);
    expect(second.getSnapshot()).toEqual({
      contents: "second",
      dirty: false,
      path: "src/second.ts",
    });
  });

  it("forwards Pierre changes and resets dirty state after a save", () => {
    const onChange = vi.fn();
    const session = createWorkspaceEditorSession({
      initialContents: "before",
      onChange,
      path: "README.md",
    });
    const editor = session.editor as unknown as InstanceType<
      typeof editorMock.Editor
    >;

    editor.options.onChange?.(
      { contents: "after", name: "README.md" },
      undefined,
      {
        changes: [],
        file: { contents: "after", name: "README.md" },
      },
    );

    expect(session.getSnapshot().dirty).toBe(true);
    expect(onChange).toHaveBeenCalledWith("after", expect.any(Object));

    session.markSaved();

    expect(session.getSnapshot().dirty).toBe(false);
  });
});
