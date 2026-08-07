import type { EditorChangeEvent } from "@pierre/diffs";
import { Editor, type EditorOptions } from "@pierre/diffs/edit";

export interface WorkspaceEditorSnapshot {
  contents: string;
  dirty: boolean;
  path: string;
}

interface CreateWorkspaceEditorSessionOptions {
  editorOptions?: Omit<EditorOptions<undefined>, "onChange">;
  initialContents: string;
  onChange?: (contents: string, event: EditorChangeEvent<undefined>) => void;
  path: string;
}

export interface WorkspaceEditorSession {
  createEditor: () => Editor<undefined>;
  destroy: () => void;
  editor: Editor<undefined>;
  getSnapshot: () => WorkspaceEditorSnapshot;
  markSaved: (contents?: string) => void;
  recordContents: (contents: string) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createWorkspaceEditorSession({
  editorOptions,
  initialContents,
  onChange,
  path,
}: CreateWorkspaceEditorSessionOptions): WorkspaceEditorSession {
  let savedContents = initialContents;
  let snapshot: WorkspaceEditorSnapshot = {
    contents: initialContents,
    dirty: false,
    path,
  };
  const listeners = new Set<() => void>();

  const updateContents = (contents: string) => {
    const nextSnapshot = {
      contents,
      dirty: contents !== savedContents,
      path,
    };
    if (
      snapshot.contents === nextSnapshot.contents &&
      snapshot.dirty === nextSnapshot.dirty
    ) {
      return;
    }
    snapshot = nextSnapshot;
    for (const listener of listeners) listener();
  };

  const editor = new Editor<undefined>({
    ...editorOptions,
    onChange: (_file, _lineAnnotations, event) => {
      updateContents(event.file.contents);
      onChange?.(event.file.contents, event);
    },
  });

  return {
    createEditor: () => editor,
    destroy: () => {
      listeners.clear();
      editor.cleanUp();
    },
    editor,
    getSnapshot: () => snapshot,
    markSaved: (contents = snapshot.contents) => {
      savedContents = contents;
      updateContents(snapshot.contents);
    },
    recordContents: updateContents,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
