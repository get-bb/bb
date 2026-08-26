import { toast } from "sonner";
import type * as MonacoNs from "monaco-editor";

type Editor = MonacoNs.editor.IStandaloneCodeEditor;

/** An editor plus what a command needs to know about the file in it. */
export type ActiveEditor = {
  editor: Editor;
  /** Where the file lives on the host that owns it. */
  absolutePath: string;
  /** That path within the workspace (or storage directory) root. */
  relativePath: string;
};

/**
 * The editor a quick-palette command should act on.
 *
 * The palette is host chrome mounted beside the routes: its `run` receives a
 * thread id, a project id, and an `openPanel` — nothing that reaches a file
 * tab. But the palette and every mounted `fileOpener` are the same plugin
 * bundle in one browser context, so the editors can simply publish
 * themselves here and the commands can read them back.
 *
 * "Which editor" is the whole problem. A user can have several Monaco tabs
 * open across split panes, all mounted at once. Last-focused is the answer
 * that matches what the palette user means by "the editor": they clicked or
 * typed in it a moment ago, then hit the palette shortcut, which moved focus
 * to the palette input.
 */
let lastFocused: ActiveEditor | null = null;

/** Called on create and on every focus, so the newest tab wins immediately. */
export function markEditorActive(active: ActiveEditor): void {
  lastFocused = active;
}

/** Called when an editor unmounts; a disposed editor must never be reachable. */
export function forgetEditor(editor: Editor): void {
  if (lastFocused?.editor === editor) lastFocused = null;
}

/**
 * The last-focused editor, if it is still on screen.
 *
 * Being remembered is not enough: the user can switch to another tab, leaving
 * our editor mounted but hidden, and folding a buffer nobody can see would be
 * a command that appears to do nothing. `isConnected` rules out a torn-down
 * node, `offsetParent` a hidden one — the container is statically positioned,
 * so a null parent means an ancestor is `display: none`.
 */
function targetEditor(): ActiveEditor | null {
  const node = lastFocused?.editor.getDomNode();
  if (!node || !node.isConnected || node.offsetParent === null) return null;
  return lastFocused;
}

/**
 * True when the selection spans more than one line.
 *
 * Monaco's sort actions treat an empty or single-line selection as "sort the
 * whole document", which is a surprising amount of damage to do to a file
 * from a palette row the user reached by typing "sort". Requiring a real
 * multi-line selection keeps the command meaning what its title says.
 */
function hasMultiLineSelection({ editor }: ActiveEditor): boolean {
  return (
    editor
      .getSelections()
      ?.some(
        (selection) =>
          !selection.isEmpty() &&
          selection.startLineNumber !== selection.endLineNumber,
      ) ?? false
  );
}

export type EditorCommand = {
  /** Palette row id, unique within this plugin. */
  id: string;
  /** Palette row label. The palette matches on this text. */
  title: string;
  /** Extra condition beyond "there is a visible editor". */
  precondition?: (active: ActiveEditor) => boolean;
  run: (active: ActiveEditor) => void | Promise<void>;
};

/** A palette row that runs one of Monaco's own editor actions. */
function monacoAction(
  id: string,
  title: string,
  actionId: string,
  precondition?: (active: ActiveEditor) => boolean,
): EditorCommand {
  return {
    id,
    title,
    precondition,
    run: async ({ editor }) => {
      // The palette took focus, and the fold actions are gated on
      // `editorTextFocus`.
      editor.focus();
      await editor.getAction(actionId)?.run();
    },
  };
}

/** Clipboard write with the same toast treatment as the file tree's copies. */
function copy(text: string, successMessage: string): Promise<void> {
  return navigator.clipboard
    .writeText(text)
    .then(() => {
      toast.success(successMessage);
    })
    .catch(() => {
      toast.error("Failed to copy");
    });
}

export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  // Monaco registers `editor.foldLevel1` through `editor.foldLevel7`; the
  // first five are the ones with any practical use on real files.
  ...[1, 2, 3, 4, 5].map((level) =>
    monacoAction(
      `fold-level-${level}`,
      `Monaco: fold level ${level}`,
      `editor.foldLevel${level}`,
    ),
  ),
  monacoAction(
    "fold-recursively",
    "Monaco: fold recursively",
    "editor.foldRecursively",
  ),
  // Monaco has no "unfold level N" to mirror the rows above — collapsing is
  // level-based, expanding is not — so "unfold all" is what undoes them.
  monacoAction("unfold-all", "Monaco: unfold all", "editor.unfoldAll"),
  monacoAction(
    "unfold-recursively",
    "Monaco: unfold recursively",
    "editor.unfoldRecursively",
  ),
  monacoAction("unfold", "Monaco: unfold at cursor", "editor.unfold"),
  monacoAction(
    "sort-lines-ascending",
    "Monaco: sort selected lines ascending",
    "editor.action.sortLinesAscending",
    hasMultiLineSelection,
  ),
  monacoAction(
    "sort-lines-descending",
    "Monaco: sort selected lines descending",
    "editor.action.sortLinesDescending",
    hasMultiLineSelection,
  ),
  {
    id: "copy-path",
    title: "Monaco: copy path of current file",
    run: ({ absolutePath }) => copy(absolutePath, "Absolute path copied"),
  },
  {
    id: "copy-relative-path",
    title: "Monaco: copy relative path of current file",
    run: ({ relativePath }) => copy(relativePath, "Relative path copied"),
  },
];

/** Whether the palette should list this command right now. */
export function isCommandAvailable(command: EditorCommand): boolean {
  const active = targetEditor();
  if (!active) return false;
  return command.precondition?.(active) ?? true;
}

/**
 * Runs the command against the editor in view.
 *
 * Re-checking availability here rather than trusting the earlier
 * `isAvailable` matters because the palette can sit open while the tab it was
 * listed for closes.
 */
export async function runEditorCommand(command: EditorCommand): Promise<void> {
  const active = targetEditor();
  if (!active || !(command.precondition?.(active) ?? true)) return;
  await command.run(active);
}
