import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useCodeTheme,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type * as MonacoNs from "monaco-editor";
import { toast } from "sonner";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import type { rpcContract } from "./server.js";
import { loadMonaco, overflowWidgetsNode, setOverflowWidgetsTheme } from "./lib/monaco-loader.js";
import { applyMarkdownTheme, editorBackground } from "./lib/markdown-theme.js";
import { DecorationController } from "./lib/decoration-controller.js";
import {
  buildTree,
  decodeSubPath,
  withMarkdownExtension,
  type FlatEntry,
  type TreeNode,
} from "./lib/notes-tree.js";
import {
  IMPORTED_VSCODE_SETTINGS,
  type NotesSettings,
} from "./lib/vscode-settings.js";
import { collectHeadings, tocBlock, updateTocBlock } from "./lib/toc.js";
import { NotesSidebar, type DraftKind } from "./components/NotesSidebar.js";
import { NotesToolbar, type SaveIndicator } from "./components/NotesToolbar.js";

const PANEL_PATH = "notes";

type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

type EditorStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function NotesPanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const codeTheme = experimental_useCodeTheme();

  const codeThemeRef = useRef(codeTheme);
  codeThemeRef.current = codeTheme;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<typeof MonacoNs | null>(null);
  const editorRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<DecorationController | null>(null);
  const sha256Ref = useRef<string | null>(null);
  const saveStateRef = useRef<SaveState>({ kind: "clean" });

  /** The route owns which note is open, so a deep link restores it. */
  const activePath = subPath === "" ? null : decodeSubPath(subPath);

  const [saveState, setSaveStateValue] = useState<SaveState>({ kind: "clean" });
  const [status, setStatus] = useState<EditorStatus>({ kind: "idle" });
  const [settings, setSettings] = useState<NotesSettings>(
    IMPORTED_VSCODE_SETTINGS,
  );
  const [root, setRoot] = useState<string>("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const [isReloading, setIsReloading] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null);
  const [tree, setTree] = useState<{
    entries: readonly FlatEntry[];
    truncated: boolean;
    isLoading: boolean;
    error: string | null;
  }>({ entries: [], truncated: false, isLoading: true, error: null });

  const setSaveState = useCallback((next: SaveState) => {
    saveStateRef.current = next;
    setSaveStateValue(next);
  }, []);

  const nodes = useMemo(() => buildTree(tree.entries), [tree.entries]);

  const openNote = useCallback(
    (path: string) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: path });
    },
    [navigate],
  );

  const refreshTree = useCallback(async () => {
    try {
      const result = await rpc.call("tree", null);
      setRoot(result.root);
      setTree({
        entries: result.entries,
        truncated: result.truncated,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setTree({
        entries: [],
        truncated: false,
        isLoading: false,
        error: errorText(error),
      });
    }
  }, [rpc]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    let cancelled = false;
    void rpc
      .call("settings", null)
      .then((result) => {
        if (cancelled) return;
        setSettings(result.settings);
        setRoot(result.root);
        const wrap = result.settings["editor.wordWrap"];
        if (wrap !== undefined) setWordWrap(wrap === "on");
      })
      .catch(() => {
        // The imported defaults already cover this; a failed read should not
        // stop the panel from opening.
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const writeContent = useCallback(
    async (expectedSha256: string | null) => {
      const editor = editorRef.current;
      if (editor === null || activePath === null) return;
      setSaveState({ kind: "saving" });
      try {
        const result = await rpc.call("write", {
          path: activePath,
          content: editor.getValue(),
          expectedSha256,
        });
        if (result.outcome === "conflict") {
          setSaveState({ kind: "conflict" });
          return;
        }
        sha256Ref.current = result.sha256;
        setSaveState({ kind: "clean" });
      } catch (error) {
        setSaveState({ kind: "error", message: errorText(error) });
      }
    },
    [activePath, rpc, setSaveState],
  );

  const save = useCallback(async () => {
    if (saveStateRef.current.kind === "saving") return;
    await writeContent(sha256Ref.current);
  }, [writeContent]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const reload = useCallback(async () => {
    const editor = editorRef.current;
    if (editor === null || activePath === null) return;
    setIsReloading(true);
    try {
      const file = await rpc.call("read", { path: activePath });
      if (file.kind !== "text") return;
      sha256Ref.current = file.sha256;
      editor.setValue(file.content);
      setSaveState({ kind: "clean" });
    } catch (error) {
      setSaveState({ kind: "error", message: errorText(error) });
    } finally {
      setIsReloading(false);
    }
  }, [activePath, rpc, setSaveState]);

  // Boot Monaco and load the open note. Re-runs per note so each gets a
  // fresh model, which is what keeps undo history from leaking between them.
  useEffect(() => {
    if (activePath === null) {
      setStatus({ kind: "idle" });
      return;
    }
    let disposed = false;
    setStatus({ kind: "loading" });

    void (async () => {
      try {
        const [{ baseUrl }, file] = await Promise.all([
          rpc.call("assets", null),
          rpc.call("read", { path: activePath }),
        ]);
        if (disposed) return;
        if (file.kind === "unsupported") {
          setStatus({ kind: "unsupported", reason: file.reason });
          return;
        }

        const monaco = await loadMonaco(baseUrl);
        if (disposed) return;
        const container = containerRef.current;
        if (container === null) return;
        monacoRef.current = monaco;

        sha256Ref.current = file.sha256;
        const applied = applyMarkdownTheme(monaco, codeThemeRef.current);
        setOverflowWidgetsTheme(applied.base);

        const editor = monaco.editor.create(container, {
          value: file.content,
          language: "markdown",
          theme: applied.name,
          automaticLayout: true,
          wordWrap: wordWrap ? "on" : "off",
          lineNumbers: settings["editor.lineNumbers"] ?? "on",
          fontSize: settings["editor.fontSize"] ?? 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          // Prose, not code: no bracket guides, no occurrence boxes, and a
          // ruler-free gutter keep a note from reading like source.
          renderLineHighlight: "none",
          occurrencesHighlight: "off",
          bracketPairColorization: { enabled: false },
          guides: { indentation: false, bracketPairs: false },
          folding: true,
          lineHeight: 21,
          padding: { top: 12, bottom: 24 },
          quickSuggestions: false,
          // Monaco's word-based suggestions fire mid-sentence while writing
          // prose, which is noise rather than help.
          wordBasedSuggestions: "off",
          unicodeHighlight: { ambiguousCharacters: false },
          fixedOverflowWidgets: true,
          overflowWidgetsDomNode: overflowWidgetsNode(),
        });
        editorRef.current = editor;
        setStatus({ kind: "ready" });

        const decorations = new DecorationController(monaco, editor);
        decorationsRef.current = decorations;
        decorations.update({
          settings,
          themeType: codeThemeRef.current.theme?.type ?? codeThemeRef.current.mode,
          colors: applied.colors,
          path: activePath,
        });

        editor.onDidChangeModelContent(() => {
          if (saveStateRef.current.kind === "clean") {
            setSaveState({ kind: "dirty" });
          }
          decorationsRef.current?.schedule();
        });
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => void saveRef.current(),
        );
      } catch (error) {
        if (disposed) return;
        setStatus({ kind: "error", message: errorText(error) });
      }
    })();

    return () => {
      disposed = true;
      decorationsRef.current?.dispose();
      decorationsRef.current = null;
      editorRef.current?.getModel()?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // `settings` and `wordWrap` are read for the initial editor options and
    // applied live by the effects below, so they are deliberately not
    // dependencies: changing them must not tear down the editor and lose the
    // user's cursor and undo stack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, rpc, setSaveState]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (monaco === null || editor === null) return;
    const applied = applyMarkdownTheme(monaco, codeTheme);
    editor.updateOptions({ theme: applied.name });
    setOverflowWidgetsTheme(applied.base);
    if (activePath !== null) {
      decorationsRef.current?.update({
        settings,
        themeType: codeTheme.theme?.type ?? codeTheme.mode,
        colors: applied.colors,
        path: activePath,
      });
    }
  }, [activePath, codeTheme, settings, status]);

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: wordWrap ? "on" : "off" });
  }, [wordWrap, status]);

  /**
   * Cmd+S outside the editor.
   *
   * Monaco's own binding only fires while the editor has focus, so after
   * clicking a toolbar button the habitual save did nothing and left the
   * note dirty with no feedback. This listener runs on the bubble phase, so
   * a focused editor still handles the key itself and this never
   * double-saves.
   */
  useEffect(() => {
    if (activePath === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePath]);

  const insertToc = useCallback(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    const model = editor.getModel();
    if (model === null) return;
    const orderedList =
      settings["markdown.extension.toc.orderedList"] === true;

    const current = model.getValue();
    const updated = updateTocBlock(current, { orderedList });
    if (updated.replaced) {
      if (updated.content !== current) {
        editor.pushUndoStop();
        editor.executeEdits("notes-toc", [
          { range: model.getFullModelRange(), text: updated.content },
        ]);
        editor.pushUndoStop();
      }
      toast.success("Table of contents updated");
      return;
    }

    if (collectHeadings(current.split("\n")).length === 0) {
      toast.info("This note has no headings to list");
      return;
    }
    const selection = editor.getSelection();
    if (selection === null) return;
    editor.pushUndoStop();
    editor.executeEdits("notes-toc", [
      { range: selection, text: tocBlock(current, { orderedList }) },
    ]);
    editor.pushUndoStop();
    toast.success(
      orderedList
        ? "Numbered table of contents inserted"
        : "Table of contents inserted",
    );
  }, [settings]);

  const requestOpen = useCallback(
    (path: string) => {
      if (path === activePath) return;
      if (saveStateRef.current.kind === "dirty") {
        setPendingNavigation(path);
        return;
      }
      openNote(path);
    },
    [activePath, openNote],
  );

  const create = useCallback(
    async (kind: DraftKind, rawPath: string) => {
      try {
        if (kind === "directory") {
          await rpc.call("createDirectory", { path: rawPath });
          await refreshTree();
          toast.success("Folder created");
          return;
        }
        const path = withMarkdownExtension(rawPath);
        const created = await rpc.call("createFile", { path });
        await refreshTree();
        openNote(created.path);
      } catch (error) {
        toast.error(errorText(error));
      }
    },
    [openNote, refreshTree, rpc],
  );

  const rename = useCallback(
    async (from: string, to: string) => {
      try {
        const target = from.includes(".") ? withMarkdownExtension(to) : to;
        const result = await rpc.call("rename", { from, to: target });
        await refreshTree();
        if (from === activePath) openNote(result.path);
        toast.success("Renamed");
      } catch (error) {
        toast.error(errorText(error));
      }
    },
    [activePath, openNote, refreshTree, rpc],
  );

  const confirmDelete = useCallback(async () => {
    const node = pendingDelete;
    setPendingDelete(null);
    if (node === null) return;
    try {
      await rpc.call("remove", {
        path: node.path,
        recursive: node.kind === "directory",
      });
      await refreshTree();
      if (
        activePath === node.path ||
        (node.kind === "directory" && activePath?.startsWith(`${node.path}/`))
      ) {
        navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
      }
      toast.success(node.kind === "directory" ? "Folder deleted" : "Note deleted");
    } catch (error) {
      toast.error(errorText(error));
    }
  }, [activePath, navigate, pendingDelete, refreshTree, rpc]);

  const background = editorBackground(codeTheme.theme);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NotesToolbar
        path={activePath}
        indicator={indicatorFor(saveState, status)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((wrap) => !wrap)}
        onInsertToc={insertToc}
        onReload={() => void reload()}
        onSave={() => void save()}
        isReloading={isReloading}
        canEdit={status.kind === "ready"}
      />

      <Notice
        onOverwrite={() => void writeContent(null)}
        onReload={() => void reload()}
        saveState={saveState}
        status={status}
      />

      <div className="flex min-h-0 flex-1">
        {isSidebarOpen ? (
          <div className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-surface-recessed">
            <NotesSidebar
              nodes={nodes}
              activePath={activePath}
              isLoading={tree.isLoading}
              error={tree.error}
              truncated={tree.truncated}
              onOpen={requestOpen}
              onCreate={(kind, path) => void create(kind, path)}
              onRename={(from, to) => void rename(from, to)}
              onDelete={setPendingDelete}
            />
            {root !== "" ? (
              <p
                title={root}
                className="shrink-0 truncate border-t border-border/60 px-3 py-1.5 text-[0.6875rem] text-subtle-foreground"
              >
                {root}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={containerRef}
            className={cn(
              "min-h-0 flex-1",
              status.kind === "ready" ? "" : "pointer-events-none opacity-0",
            )}
            style={background === null ? undefined : { background }}
          />
          {status.kind !== "ready" ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <EmptyState status={status} hasNotes={nodes.length > 0} />
            </div>
          ) : null}
        </div>
      </div>

      <Dialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNavigation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              {activePath} has changes that have not been saved. Opening
              another note will lose them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingNavigation(null)}
            >
              Keep editing
            </Button>
            <Button
              onClick={() => {
                const next = pendingNavigation;
                setPendingNavigation(null);
                if (next !== null) {
                  setSaveState({ kind: "clean" });
                  openNote(next);
                }
              }}
            >
              Discard and open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {pendingDelete?.kind === "directory" ? "folder" : "note"}?
            </DialogTitle>
            <DialogDescription>
              {pendingDelete?.kind === "directory"
                ? `${pendingDelete?.name} and everything inside it will be deleted from disk.`
                : `${pendingDelete?.name} will be deleted from disk.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  status,
  hasNotes,
}: {
  status: EditorStatus;
  hasNotes: boolean;
}) {
  if (status.kind === "loading") {
    return (
      <p className="text-xs text-subtle-foreground">Opening note…</p>
    );
  }
  if (status.kind === "error") {
    return <p className="text-xs text-destructive">{status.message}</p>;
  }
  if (status.kind === "unsupported") {
    return <p className="text-xs text-subtle-foreground">{status.reason}</p>;
  }
  return (
    <p className="max-w-sm text-center text-xs text-subtle-foreground">
      {hasNotes
        ? "Pick a note from the list to start editing."
        : "No notes yet. Use New note in the list to create your first one."}
    </p>
  );
}

function indicatorFor(
  saveState: SaveState,
  status: EditorStatus,
): SaveIndicator {
  if (status.kind === "error") return "error";
  switch (saveState.kind) {
    case "saving":
      return "saving";
    case "dirty":
      return "dirty";
    case "error":
    case "conflict":
      return "error";
    default:
      return "clean";
  }
}

function Notice({
  onOverwrite,
  onReload,
  saveState,
  status,
}: {
  onOverwrite: () => void;
  onReload: () => void;
  saveState: SaveState;
  status: EditorStatus;
}) {
  if (saveState.kind === "conflict") {
    return (
      <NoticeRow tone="error">
        This note changed on disk since you opened it.
        <NoticeAction onClick={onReload}>Reload</NoticeAction>
        <NoticeAction onClick={onOverwrite}>Overwrite</NoticeAction>
      </NoticeRow>
    );
  }
  if (saveState.kind === "error") {
    return <NoticeRow tone="error">{saveState.message}</NoticeRow>;
  }
  if (status.kind === "error") {
    return <NoticeRow tone="error">{status.message}</NoticeRow>;
  }
  return null;
}

function NoticeRow({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "error" | "warning";
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 items-center gap-2 px-4 py-1.5 text-xs",
        tone === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-surface-recessed text-foreground",
      )}
    >
      {children}
    </div>
  );
}

function NoticeAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-sm font-medium underline underline-offset-2 hover:opacity-80 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "notes",
    title: "Notes",
    icon: "FileText",
    path: PANEL_PATH,
    component: NotesPanel,
  });
});
