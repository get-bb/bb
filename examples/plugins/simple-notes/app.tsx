// bb-plugin-simple-notes frontend — a minimal Simple Notes surface.
//
// A single navPanel (chrome "none", so we own the whole body): the notes list
// on the left, a headless Tiptap WYSIWYG editor on the right, styled from host
// theme tokens. The selected note lives in the panel's subPath, so browser
// back/forward and deep links work. Edits autosave (debounced) and on
// Cmd/Ctrl+S; task-list checkboxes in the rich editor cover todos.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { Editor, Extension, InputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit02Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// --- rpc result shapes (rpc is untyped in V1 — narrow at the boundary) ------

interface NoteSummary {
  path: string;
  title: string;
  preview: string;
  modifiedAtMs: number;
}

interface NotesData {
  root: string;
  notes: NoteSummary[];
  error: string | null;
}

interface NoteContent {
  content: string;
  sha256: string;
}

type SaveResult =
  | { outcome: "written"; sha256: string }
  | { outcome: "conflict"; currentSha256: string | null };

// --- editor styling ---------------------------------------------------------
// Tiptap is headless, so this stylesheet IS the editor's look. Everything is
// derived from host theme tokens (var(--foreground), --muted, --primary, …) so
// it tracks the app palette in light and dark. Injected once per session.

const STYLE_MARKER = "data-bb-simple-notes-styles";

const EDITOR_CSS = `
.bb-simple-notes-editor .tiptap {
  outline: none;
  width: 100%;
  max-width: 48em;
  margin: 0 auto;
  padding: 3rem 1.5rem 40vh;
  font-size: 15px;
  line-height: 1.75;
  color: var(--foreground);
  caret-color: var(--foreground);
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
}
.bb-simple-notes-editor .tiptap > :first-child,
.bb-simple-notes-editor .tiptap li > :first-child,
.bb-simple-notes-editor .tiptap blockquote > :first-child { margin-top: 0; }
.bb-simple-notes-editor .tiptap p { margin: 1.25em 0 0; }
.bb-simple-notes-editor .tiptap h1,
.bb-simple-notes-editor .tiptap h2,
.bb-simple-notes-editor .tiptap h3,
.bb-simple-notes-editor .tiptap h4,
.bb-simple-notes-editor .tiptap h5,
.bb-simple-notes-editor .tiptap h6 { margin-bottom: 0; color: var(--foreground); font-weight: 600; }
.bb-simple-notes-editor .tiptap h1 { font-size: 1.75em; line-height: 1.3; margin-top: 1.25em; }
.bb-simple-notes-editor .tiptap h2 { font-size: 1.25em; line-height: 1.4; margin-top: 1.75em; }
.bb-simple-notes-editor .tiptap h3 { font-size: 1.125em; line-height: 1.45; margin-top: 1.25em; }
.bb-simple-notes-editor .tiptap h4 { font-size: 1em; line-height: 1.5; margin-top: 1.25em; }
.bb-simple-notes-editor .tiptap h5 { font-size: 0.875em; line-height: 1.5; font-weight: 500; color: var(--muted-foreground); margin-top: 1.43em; }
.bb-simple-notes-editor .tiptap h6 { font-size: 0.8125em; line-height: 1.5; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted-foreground); margin-top: 1.54em; }
.bb-simple-notes-editor .tiptap :is(h1, h2, h3, h4, h5, h6) + * { margin-top: 1em; }
.bb-simple-notes-editor .tiptap ul, .bb-simple-notes-editor .tiptap ol { margin: 1.25em 0 0; padding-left: 1.5em; }
.bb-simple-notes-editor .tiptap ul { list-style: disc; }
.bb-simple-notes-editor .tiptap ol { list-style: decimal; }
.bb-simple-notes-editor .tiptap li { margin-top: 0.5em; padding-left: 0.4em; }
.bb-simple-notes-editor .tiptap li > p, .bb-simple-notes-editor .tiptap li > ul, .bb-simple-notes-editor .tiptap li > ol { margin-top: 0.5em; }
.bb-simple-notes-editor .tiptap li::marker { color: var(--muted-foreground); }
.bb-simple-notes-editor .tiptap a { color: inherit; font-weight: 500; text-decoration: underline; text-decoration-color: color-mix(in oklab, currentColor 30%, transparent); cursor: pointer; }
.bb-simple-notes-editor .tiptap a:hover { text-decoration-color: currentColor; }
.bb-simple-notes-editor .tiptap a:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 0.125em; }
.bb-simple-notes-editor .tiptap strong { font-weight: 600; }
.bb-simple-notes-editor .tiptap code {
  background: var(--muted); border-radius: min(calc(var(--radius) * 0.6), 0.35em); padding: 0.125em 0.3em;
  font-size: 0.85em; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.bb-simple-notes-editor .tiptap pre {
  background: var(--muted); border-radius: var(--radius);
  padding: 0.75em 1em; overflow-x: auto; font-size: 0.875em; line-height: 1.5;
  margin: 1.43em 0 0; tab-size: 2;
}
.bb-simple-notes-editor .tiptap pre code { background: none; padding: 0; font-size: inherit; }
.bb-simple-notes-editor .tiptap blockquote {
  border-left: 2px solid var(--border); padding-left: 1em; margin: 1.25em 0 0;
}
.bb-simple-notes-editor .tiptap hr { border: none; border-top: 1px solid var(--border); margin: 3em 0 0; }
.bb-simple-notes-editor .tiptap hr + :is(h1, h2, h3, h4) { margin-top: 1.25em; }
/* GFM task lists (todos) */
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0.25em; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; margin-top: 0.5em; padding-left: 0; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li > label {
  flex: 0 0 auto; display: inline-flex; align-items: center; height: 1.7em; user-select: none;
}
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li > div > p { line-height: 1.75; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] input[type="checkbox"] {
  display: block; width: 15px; height: 15px; accent-color: var(--primary); cursor: pointer; margin: 0;
}
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li[data-checked="true"] > div {
  color: var(--muted-foreground); text-decoration: line-through;
}
/* placeholder (empty document) */
.bb-simple-notes-editor .tiptap p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left; height: 0; pointer-events: none; color: var(--muted-foreground);
}
.bb-simple-notes-editor .tiptap ::selection { background: color-mix(in oklab, var(--primary) 22%, transparent); }
@media (max-width: 47.999rem) {
  .bb-simple-notes-editor .tiptap { padding-inline: 1.25rem; font-size: 16.875px; }
}
`;

function ensureEditorStyles(): void {
  if (document.head.querySelector(`[${STYLE_MARKER}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_MARKER, "");
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

// GFM checkbox input: typing "[ ] ", "[] " or "[x] " turns the line into a
// checkbox — and so does the natural "- [ ] " (the "- " first becomes a bullet
// via StarterKit, then this rule converts that list into a task list). Runs at
// a higher priority than the default task-item rule so it handles both the
// plain-paragraph and inside-a-bullet cases via toggleTaskList().
const MarkdownTaskInput = Extension.create({
  name: "markdownTaskInput",
  priority: 200,
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*\[([ xX]?)\]\s$/,
        handler: ({ range, match, chain }) => {
          const checked = /[xX]/.test(match[1] ?? "");
          const commands = chain().deleteRange(range).toggleTaskList();
          if (checked) commands.updateAttributes("taskItem", { checked: true });
          commands.run();
        },
      }),
    ];
  },
});

// --- the Tiptap editor ------------------------------------------------------
// Remounted (via key) per note; markdown flows out through a ref so the effect
// never re-runs mid-edit. Tiptap's `update` never fires for the initial
// content, so we publish the normalized initial markdown once via
// `onFirstRender` as the saved baseline — that keeps merely opening a note from
// looking "dirty" and triggering a save.

function TiptapEditor({
  initialValue,
  onFirstRender,
  onMarkdownChange,
}: {
  initialValue: string;
  onFirstRender: (markdown: string) => void;
  onMarkdownChange: (markdown: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef(onFirstRender);
  firstRef.current = onFirstRender;
  const changeRef = useRef(onMarkdownChange);
  changeRef.current = onMarkdownChange;

  useEffect(() => {
    ensureEditorStyles();
    const element = rootRef.current;
    if (!element) return;
    const editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Link.configure({ openOnClick: false, autolink: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        MarkdownTaskInput,
        Placeholder.configure({ placeholder: "Start writing…" }),
        // tiptap-markdown: parses `content` as markdown and exposes
        // editor.storage.markdown.getMarkdown() for serialization.
        Markdown.configure({
          html: false,
          tightLists: true,
          bulletListMarker: "-",
          linkify: true,
        }),
      ],
      content: initialValue,
      autofocus: "end",
    });
    const getMarkdown = (): string => editor.storage.markdown.getMarkdown();
    firstRef.current(getMarkdown());
    editor.on("update", () => changeRef.current(getMarkdown()));
    return () => {
      editor.destroy();
    };
    // initialValue is captured once — the editor owns the document after mount;
    // callers remount with a new key to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className="bb-simple-notes-editor min-h-0 flex-1 overflow-y-auto"
    />
  );
}

// --- the editor pane over one note ------------------------------------------

type PaneState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; initialContent: string };

const AUTOSAVE_MS = 700;

function SidebarButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.8} />
    </button>
  );
}

function NoteEditorPane({
  notePath,
  onListChanged,
  onRenamed,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  /** Path at open time; the pane owns the live path from here (via rename). */
  notePath: string;
  onListChanged: () => void;
  onRenamed: (path: string) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const rpc = useRpc();
  const [pane, setPane] = useState<PaneState>({ phase: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Live editing state kept outside React so keystrokes don't re-render.
  const livePathRef = useRef(notePath); // updated in place as the file renames
  const markdownRef = useRef("");
  const savedContentRef = useRef("");
  const sha256Ref = useRef<string | null>(null);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onListChangedRef = useRef(onListChanged);
  onListChangedRef.current = onListChanged;
  const onRenamedRef = useRef(onRenamed);
  onRenamedRef.current = onRenamed;
  const doSaveRef = useRef<(options?: { force?: boolean }) => Promise<void>>(
    async () => {},
  );

  // Save the current markdown, then — live, on every autosave — settle the
  // filename to the kebab-case of the title. The rename updates the live path
  // in place, so the editor never remounts and the cursor stays put.
  const doSave = useCallback(
    async (options?: { force?: boolean }) => {
      if (savingRef.current) return;
      if (!options?.force && markdownRef.current === savedContentRef.current) {
        return;
      }
      savingRef.current = true;
      setSaveError(null);
      const content = markdownRef.current;
      const expected = sha256Ref.current;
      try {
        const result = (await rpc.call("saveNote", {
          path: livePathRef.current,
          content,
          ...(!options?.force && typeof expected === "string"
            ? { expectedSha256: expected }
            : {}),
        })) as SaveResult;
        if (result.outcome === "conflict") {
          setConflict(true);
          return;
        }
        savedContentRef.current = content;
        sha256Ref.current = result.sha256;
        setConflict(false);
        onListChangedRef.current();
        const renamed = (await rpc.call("renameToTitle", {
          path: livePathRef.current,
        })) as { path: string };
        if (renamed.path !== livePathRef.current) {
          livePathRef.current = renamed.path;
          onRenamedRef.current(renamed.path);
          onListChangedRef.current();
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      } finally {
        savingRef.current = false;
      }
    },
    [rpc],
  );
  doSaveRef.current = doSave;

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSaveRef.current();
    }, AUTOSAVE_MS);
  }, []);

  // Load on mount (the parent remounts this pane per note via a key) and on an
  // explicit conflict reload. On unmount, flush unsaved edits + settle the name.
  useEffect(() => {
    let alive = true;
    const loadPath = livePathRef.current;
    setPane({ phase: "loading" });
    setSaveError(null);
    setConflict(false);
    rpc
      .call("readNote", { path: loadPath })
      .then((result) => {
        if (!alive) return;
        const note = result as NoteContent;
        markdownRef.current = note.content;
        savedContentRef.current = note.content;
        sha256Ref.current = note.sha256;
        setPane({ phase: "ready", initialContent: note.content });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setPane({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      alive = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = markdownRef.current;
      const dirty = pending !== savedContentRef.current;
      const path = livePathRef.current;
      const sha = sha256Ref.current;
      void (async () => {
        if (dirty) {
          await rpc
            .call("saveNote", {
              path,
              content: pending,
              ...(typeof sha === "string" ? { expectedSha256: sha } : {}),
            })
            .catch(() => {});
        }
        await rpc.call("renameToTitle", { path }).catch(() => {});
        onListChangedRef.current();
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadNonce, rpc]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void doSaveRef.current();
    }
  }, []);

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={handleKeyDown}
    >
      {sidebarCollapsed ? (
        <div className="absolute left-2 top-2 z-10">
          <SidebarButton onClick={onToggleSidebar} label="Show sidebar" />
        </div>
      ) : null}
      {conflict ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-4 py-1.5 text-xs">
          <span>This note changed on disk since it was opened.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReloadNonce((n) => n + 1)}
          >
            Reload
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void doSaveRef.current({ force: true })}
          >
            Overwrite
          </Button>
        </div>
      ) : null}
      {saveError ? (
        <div className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-destructive">
          {saveError}
        </div>
      ) : null}
      {pane.phase === "loading" ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : pane.phase === "error" ? (
        <div className="p-6 text-sm text-destructive">{pane.message}</div>
      ) : (
        <TiptapEditor
          key={reloadNonce}
          initialValue={pane.initialContent}
          onFirstRender={(markdown) => {
            markdownRef.current = markdown;
            savedContentRef.current = markdown;
          }}
          onMarkdownChange={(markdown) => {
            markdownRef.current = markdown;
            if (markdown === savedContentRef.current) return;
            scheduleSave();
          }}
        />
      )}
    </div>
  );
}

// --- notes data -------------------------------------------------------------

function useNotes(): { data: NotesData | null; refresh: () => void } {
  const rpc = useRpc();
  const [data, setData] = useState<NotesData | null>(null);
  const refresh = useCallback(() => {
    rpc
      .call("listNotes")
      .then((result) => setData(result as NotesData))
      .catch((error: unknown) =>
        setData({
          root: "",
          notes: [],
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  }, [rpc]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { data, refresh };
}

// --- the notes list (left column) ------------------------------------------

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function NotesList({
  data,
  selectedPath,
  onSelect,
  onNew,
  onCollapse,
}: {
  data: NotesData | null;
  selectedPath: string | null;
  onSelect: (notePath: string) => void;
  onNew: () => void;
  onCollapse: () => void;
}) {
  const [query, setQuery] = useState("");
  const notes = data?.notes ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.preview.toLowerCase().includes(needle),
    );
  }, [notes, query]);

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border p-2">
        <SidebarButton onClick={onCollapse} label="Collapse sidebar" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes"
          className="h-8"
        />
        <button
          type="button"
          onClick={onNew}
          aria-label="New note"
          title="New note"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <HugeiconsIcon icon={PencilEdit02Icon} size={19} strokeWidth={1.8} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data?.error ? (
          <div className="p-3 text-xs text-destructive">{data.error}</div>
        ) : notes.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No notes yet. Use the compose button to create your first note.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No notes match “{query}”.
          </div>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((note) => (
              <li key={note.path}>
                <button
                  type="button"
                  onClick={() => onSelect(note.path)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2.5 text-left hover:bg-accent",
                    selectedPath === note.path && "bg-accent",
                  )}
                >
                  <span className="truncate text-sm font-medium">
                    {note.title || "Untitled"}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0">
                      {formatTime(note.modifiedAtMs)}
                    </span>
                    {note.preview ? (
                      <span className="truncate">{note.preview}</span>
                    ) : (
                      <span className="italic">No additional text</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {data?.root ? (
        <div
          className="shrink-0 truncate border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground"
          title={data.root}
        >
          {data.root}
        </div>
      ) : null}
    </div>
  );
}

// --- the panel --------------------------------------------------------------

function NotesPanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc();
  const navigate = useBbNavigate();
  const { data, refresh } = useNotes();
  const urlPath = subPath ? decodeURIComponent(subPath) : null;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bb-simple-notes:sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(
          "bb-simple-notes:sidebar-collapsed",
          next ? "1" : "0",
        );
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  // Open-note session: `id` keys the editor mount; `path` is the live file. A
  // live rename changes `path` under the same `id` (no remount, cursor kept);
  // navigating to a different note (click, deep link, back/forward, delete)
  // changes the URL, which bumps `id` for a fresh load.
  const [open, setOpen] = useState<{ id: number; path: string | null }>(() => ({
    id: 0,
    path: urlPath,
  }));
  useEffect(() => {
    setOpen((prev) =>
      prev.path === urlPath ? prev : { id: prev.id + 1, path: urlPath },
    );
  }, [urlPath]);

  // Remember the last note across visits to the Simple Notes tab.
  useEffect(() => {
    if (!open.path) return;
    try {
      localStorage.setItem("bb-simple-notes:last-note", open.path);
    } catch {
      // ignore storage failures
    }
  }, [open.path]);

  // Arriving at Simple Notes with no note in the URL: reopen the last one,
  // if it still exists. Runs once per mount.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (urlPath !== null) {
      restoredRef.current = true;
      return;
    }
    if (!data) return; // wait for the note list to load
    restoredRef.current = true;
    let last: string | null = null;
    try {
      last = localStorage.getItem("bb-simple-notes:last-note");
    } catch {
      last = null;
    }
    if (last && data.notes.some((note) => note.path === last)) {
      navigate.toPluginPanel("simple-notes", {
        subPath: encodeURIComponent(last),
        replace: true,
      });
    }
  }, [urlPath, data, navigate]);

  const openNote = useCallback(
    (notePath: string) => {
      navigate.toPluginPanel("simple-notes", {
        subPath: encodeURIComponent(notePath),
      });
    },
    [navigate],
  );

  const handleRenamed = useCallback(
    (newPath: string) => {
      setOpen((prev) => ({ id: prev.id, path: newPath }));
      navigate.toPluginPanel("simple-notes", {
        subPath: encodeURIComponent(newPath),
        replace: true,
      });
    },
    [navigate],
  );

  const newNote = useCallback(() => {
    rpc
      .call("createNote", { name: "Untitled" })
      .then((result) => {
        refresh();
        openNote((result as { path: string }).path);
      })
      .catch((error: unknown) => {
        console.warn("[plugin:simple-notes] create failed:", error);
      });
  }, [rpc, refresh, openNote]);

  return (
    <div className="flex min-h-0 flex-1">
      {!collapsed ? (
        <NotesList
          data={data}
          selectedPath={open.path}
          onSelect={openNote}
          onNew={newNote}
          onCollapse={toggleSidebar}
        />
      ) : null}
      {open.path ? (
        <NoteEditorPane
          key={open.id}
          notePath={open.path}
          onListChanged={refresh}
          onRenamed={handleRenamed}
          sidebarCollapsed={collapsed}
          onToggleSidebar={toggleSidebar}
        />
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
          {collapsed ? (
            <div className="absolute left-2 top-2">
              <SidebarButton onClick={toggleSidebar} label="Show sidebar" />
            </div>
          ) : null}
          <p>Select a note, or create a new one.</p>
          <Button size="sm" variant="outline" onClick={newNote}>
            New note
          </Button>
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "simple-notes",
    title: "Simple Notes",
    icon: "FileText",
    path: "simple-notes",
    chrome: "none",
    component: NotesPanel,
  });
});
