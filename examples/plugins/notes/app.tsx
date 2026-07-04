// bb-plugin-notes frontend: an Obsidian-style notes surface.
// - navPanel "Notes" (chrome none): mounted-directory tree + Milkdown Crepe
//   WYSIWYG editor, deep-linked via the panel's subPath.
// - threadPanelAction "Open note": the same editor in a thread's side panel.
// - fileOpener "Notes editor" for md/mdx/markdown: workspace/host markdown
//   opened in the panel renders here instead of the read-only preview (set
//   as default via the tab's "Open with" menu).
// - useComposer(): quote a selection (or the whole note) into the chat
//   draft, or insert an @-mention pill that resolves the note at send time.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
  type PluginFileOpenerProps,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
import { Crepe } from "@milkdown/crepe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// rpc result shapes (rpc is untyped in V1 — narrow at the boundary).
// ---------------------------------------------------------------------------

interface MountListing {
  name: string;
  root: string;
  files: { path: string; name: string }[];
  error: string | null;
}

interface NoteContent {
  content: string;
  sha256: string;
}

type SaveResult =
  | { outcome: "written"; sha256: string }
  | { outcome: "conflict"; currentSha256: string | null };

interface ResolvedFile {
  absPath: string;
  rootPath: string | null;
  hostId: string | null;
}

function asMounts(value: unknown): MountListing[] {
  const mounts = (value as { mounts?: unknown })?.mounts;
  return Array.isArray(mounts) ? (mounts as MountListing[]) : [];
}

// ---------------------------------------------------------------------------
// Crepe theme wiring. The plugin server serves Crepe's own stylesheet (the
// frontend bundle ships only Tailwind CSS); host-token variable overrides
// keep the editor on the app palette in both light and dark themes.
// ---------------------------------------------------------------------------

const CREPE_CSS_URL = "/api/v1/plugins/notes/http/crepe.css";
const STYLE_MARKER = "data-bb-notes-styles";

const EDITOR_THEME_CSS = `
.bb-notes-editor .milkdown {
  --crepe-color-background: transparent;
  --crepe-color-on-background: var(--foreground);
  --crepe-color-surface: var(--background);
  --crepe-color-surface-low: var(--muted);
  --crepe-color-on-surface: var(--foreground);
  --crepe-color-on-surface-variant: var(--muted-foreground);
  --crepe-color-outline: var(--border);
  --crepe-color-primary: var(--primary);
  --crepe-color-secondary: var(--secondary);
  --crepe-color-on-secondary: var(--secondary-foreground);
  --crepe-color-inverse: var(--foreground);
  --crepe-color-on-inverse: var(--background);
  --crepe-color-inline-code: var(--destructive);
  --crepe-color-error: var(--destructive);
  --crepe-color-hover: var(--accent);
  --crepe-color-selected: var(--accent);
  --crepe-color-inline-area: var(--muted);
  --crepe-font-title: inherit;
  --crepe-font-default: inherit;
  --crepe-font-code: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  height: 100%;
  font-size: 14px;
}
.bb-notes-editor .milkdown .ProseMirror {
  padding: 20px 28px 96px;
}
`;

function ensureEditorStyles(): void {
  if (document.head.querySelector(`[${STYLE_MARKER}]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CREPE_CSS_URL;
  link.setAttribute(STYLE_MARKER, "link");
  document.head.appendChild(link);
  const style = document.createElement("style");
  style.setAttribute(STYLE_MARKER, "style");
  style.textContent = EDITOR_THEME_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// The Crepe editor. Remounted (via key) per note; markdown flows out through
// a ref so the effect never re-runs mid-edit.
// ---------------------------------------------------------------------------

function CrepeEditor({
  initialValue,
  onMarkdownChange,
}: {
  initialValue: string;
  onMarkdownChange: (markdown: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onMarkdownChange);
  onChangeRef.current = onMarkdownChange;

  useEffect(() => {
    ensureEditorStyles();
    const root = rootRef.current;
    if (!root) return;
    const crepe = new Crepe({ root, defaultValue: initialValue });
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown);
      });
    });
    void crepe.create();
    return () => {
      void crepe.destroy();
    };
    // initialValue is intentionally captured once — the editor owns the
    // document after mount; callers remount with a new key to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className="bb-notes-editor min-h-0 flex-1 overflow-y-auto"
    />
  );
}

// ---------------------------------------------------------------------------
// One editor pane over an abstract load/save target.
// ---------------------------------------------------------------------------

interface NoteTarget {
  /** Stable identity — remounts the editor when it changes. */
  key: string;
  /** Filename shown in the pane header. */
  name: string;
  load(): Promise<NoteContent>;
  save(content: string, expectedSha256: string | null | undefined): Promise<SaveResult>;
  /** Present for mount-backed notes: enables the @-mention button. */
  mention?: { provider: string; id: string; label: string };
}

type PaneState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; initialContent: string; sha256: string };

function NoteEditorPane({ target }: { target: NoteTarget }) {
  const composer = useComposer();
  const [state, setState] = useState<PaneState>({ phase: "loading" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Latest markdown + the sha we loaded/saved against, outside render state
  // so keystrokes don't re-render the pane.
  const markdownRef = useRef("");
  const sha256Ref = useRef<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    setDirty(false);
    setConflict(false);
    setNotice(null);
    target
      .load()
      .then((note) => {
        if (!alive) return;
        markdownRef.current = note.content;
        sha256Ref.current = note.sha256;
        setState({
          phase: "ready",
          initialContent: note.content,
          sha256: note.sha256,
        });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      alive = false;
    };
  }, [target.key, reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    async (options?: { force?: boolean }) => {
      if (saving) return;
      setSaving(true);
      setNotice(null);
      try {
        const result = await target.save(
          markdownRef.current,
          options?.force ? undefined : sha256Ref.current,
        );
        if (result.outcome === "conflict") {
          setConflict(true);
        } else {
          sha256Ref.current = result.sha256;
          setDirty(false);
          setConflict(false);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
    },
    [saving, target],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void save();
      }
    },
    [save],
  );

  const quoteToChat = useCallback(() => {
    const selection = window.getSelection()?.toString() ?? "";
    composer.addQuote(
      selection.trim().length > 0 ? selection : markdownRef.current,
    );
  }, [composer]);

  const mentionInChat = useCallback(() => {
    if (target.mention) composer.insertMention(target.mention);
  }, [composer, target.mention]);

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={handleKeyDown}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 truncate text-sm font-medium">
          {target.name}
        </span>
        {dirty ? (
          <span className="text-xs text-muted-foreground">edited</span>
        ) : null}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={quoteToChat}>
          Add to chat
        </Button>
        {target.mention ? (
          <Button size="sm" variant="ghost" onClick={mentionInChat}>
            @-mention
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {conflict ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-xs">
          <span>This file changed on disk since it was loaded.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReloadNonce((nonce) => nonce + 1)}
          >
            Reload
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void save({ force: true })}
          >
            Overwrite
          </Button>
        </div>
      ) : null}
      {notice ? (
        <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-destructive">
          {notice}
        </div>
      ) : null}
      {state.phase === "loading" ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : state.phase === "error" ? (
        <div className="p-4 text-sm text-destructive">{state.message}</div>
      ) : (
        <CrepeEditor
          key={`${target.key}:${reloadNonce}:${state.sha256}`}
          initialValue={state.initialContent}
          onMarkdownChange={(markdown) => {
            markdownRef.current = markdown;
            setDirty(true);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount-backed note targets (nav panel + thread panel action).
// ---------------------------------------------------------------------------

function useMounts(): {
  mounts: MountListing[] | null;
  error: string | null;
  refresh: () => void;
} {
  const rpc = useRpc();
  const [mounts, setMounts] = useState<MountListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    rpc
      .call("listNotes")
      .then((result) => {
        setMounts(asMounts(result));
        setError(null);
      })
      .catch((rpcError: unknown) => {
        setError(
          rpcError instanceof Error ? rpcError.message : String(rpcError),
        );
      });
  }, [rpc]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useRealtime("notes-changed", refresh);
  return { mounts, error, refresh };
}

function useMountNoteTarget(
  mount: MountListing | undefined,
  notePath: string | null,
): NoteTarget | null {
  const rpc = useRpc();
  return useMemo(() => {
    if (!mount || notePath === null) return null;
    const root = mount.root;
    return {
      key: `${root}\n${notePath}`,
      name: notePath.split("/").at(-1) ?? notePath,
      async load() {
        return (await rpc.call("readNote", {
          root,
          path: notePath,
        })) as NoteContent;
      },
      async save(content, expectedSha256) {
        return (await rpc.call("saveNote", {
          root,
          path: notePath,
          content,
          ...(expectedSha256 !== undefined ? { expectedSha256 } : {}),
        })) as SaveResult;
      },
      mention: {
        provider: "notes",
        id: `${root}\n${notePath}`,
        label: notePath.split("/").at(-1) ?? notePath,
      },
    };
  }, [mount, notePath, rpc]);
}

// ---------------------------------------------------------------------------
// The notes tree (shared by the nav panel and the thread panel picker).
// ---------------------------------------------------------------------------

function NotesTree({
  mounts,
  error,
  selectedKey,
  onSelect,
  onCreate,
}: {
  mounts: MountListing[] | null;
  error: string | null;
  selectedKey: string | null;
  onSelect: (mountIndex: number, path: string) => void;
  onCreate?: (mountIndex: number, name: string) => void;
}) {
  const [draftByMount, setDraftByMount] = useState<Record<number, string>>({});
  if (error) {
    return <div className="p-3 text-xs text-destructive">{error}</div>;
  }
  if (mounts === null) {
    return <div className="p-3 text-xs text-muted-foreground">Loading…</div>;
  }
  if (mounts.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No note directories yet. Add one under Settings → Plugins → notes
        (e.g. <code>~/Notes</code>), then reload the plugin.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-2">
      {mounts.map((mount, mountIndex) => (
        <div key={mount.root}>
          <div className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {mount.name}
          </div>
          {mount.error ? (
            <div className="px-1 text-xs text-destructive">{mount.error}</div>
          ) : (
            <div className="flex flex-col">
              {mount.files.map((file) => {
                const key = `${mountIndex}/${file.path}`;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => onSelect(mountIndex, file.path)}
                    className={cn(
                      "truncate rounded px-2 py-1 text-left text-sm hover:bg-state-hover",
                      selectedKey === key && "bg-state-active font-medium",
                    )}
                    title={file.path}
                  >
                    {file.path}
                  </button>
                );
              })}
              {mount.files.length === 0 ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  No markdown files yet.
                </div>
              ) : null}
            </div>
          )}
          {onCreate ? (
            <form
              className="mt-1 flex items-center gap-1 px-1"
              onSubmit={(event) => {
                event.preventDefault();
                const draft = (draftByMount[mountIndex] ?? "").trim();
                if (draft.length === 0) return;
                onCreate(
                  mountIndex,
                  draft.endsWith(".md") ? draft : `${draft}.md`,
                );
                setDraftByMount((previous) => ({
                  ...previous,
                  [mountIndex]: "",
                }));
              }}
            >
              <Input
                value={draftByMount[mountIndex] ?? ""}
                onChange={(event) =>
                  setDraftByMount((previous) => ({
                    ...previous,
                    [mountIndex]: event.target.value,
                  }))
                }
                placeholder="new-note.md"
                className="h-7 text-xs"
              />
              <Button size="sm" variant="ghost" type="submit">
                +
              </Button>
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// navPanel: tree + editor, deep-linked via subPath ("<mountIndex>/<path>").
// ---------------------------------------------------------------------------

function parseSubPath(subPath: string): { mountIndex: number; path: string } | null {
  const slash = subPath.indexOf("/");
  if (slash === -1) return null;
  const mountIndex = Number(subPath.slice(0, slash));
  const path = subPath.slice(slash + 1);
  if (!Number.isInteger(mountIndex) || mountIndex < 0 || path.length === 0) {
    return null;
  }
  return { mountIndex, path };
}

function NotesPanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc();
  const navigate = useBbNavigate();
  const { mounts, error, refresh } = useMounts();
  const selected = useMemo(() => parseSubPath(subPath), [subPath]);
  const selectedMount =
    selected === null ? undefined : mounts?.[selected.mountIndex];
  const target = useMountNoteTarget(
    selectedMount,
    selected === null ? null : selected.path,
  );

  const openNote = useCallback(
    (mountIndex: number, path: string) => {
      navigate.toPluginPanel("notes", { subPath: `${mountIndex}/${path}` });
    },
    [navigate],
  );

  const createNote = useCallback(
    (mountIndex: number, name: string) => {
      const mount = mounts?.[mountIndex];
      if (!mount) return;
      rpc
        .call("saveNote", {
          root: mount.root,
          path: name,
          content: `# ${name.replace(/\.mdx?$|\.markdown$/i, "")}\n\n`,
          expectedSha256: null,
        })
        .then(() => {
          refresh();
          openNote(mountIndex, name);
        })
        .catch((createError: unknown) => {
          console.warn(`[plugin:notes] create failed:`, createError);
        });
    },
    [mounts, openNote, refresh, rpc],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border">
        <NotesTree
          mounts={mounts}
          error={error}
          selectedKey={
            selected === null
              ? null
              : `${selected.mountIndex}/${selected.path}`
          }
          onSelect={openNote}
          onCreate={createNote}
        />
      </div>
      {target ? (
        <NoteEditorPane target={target} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Select a note to start writing.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// threadPanelAction: the same editor inside a thread's side panel.
// ---------------------------------------------------------------------------

function NotePanelTab(_props: PluginThreadPanelProps) {
  const { mounts, error } = useMounts();
  const [selected, setSelected] = useState<{
    mountIndex: number;
    path: string;
  } | null>(null);
  const selectedMount =
    selected === null ? undefined : mounts?.[selected.mountIndex];
  const target = useMountNoteTarget(
    selectedMount,
    selected === null ? null : selected.path,
  );

  if (target) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-border px-2 py-1">
          <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
            ← All notes
          </Button>
        </div>
        <NoteEditorPane target={target} />
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      <NotesTree
        mounts={mounts}
        error={error}
        selectedKey={null}
        onSelect={(mountIndex, path) => setSelected({ mountIndex, path })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// fileOpener: workspace/host markdown in the notes editor.
// ---------------------------------------------------------------------------

function NotesFileOpener({ path, source }: PluginFileOpenerProps) {
  const rpc = useRpc();
  const [resolved, setResolved] = useState<ResolvedFile | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setResolved(null);
    setResolveError(null);
    rpc
      .call("resolveFile", { source, path })
      .then((result) => {
        if (alive) setResolved(result as ResolvedFile);
      })
      .catch((error: unknown) => {
        if (alive) {
          setResolveError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [path, rpc, source]);

  const target = useMemo<NoteTarget | null>(() => {
    if (resolved === null) return null;
    return {
      key: `file:${resolved.absPath}`,
      name: path.split("/").at(-1) ?? path,
      async load() {
        return (await rpc.call("readFile", resolved)) as NoteContent;
      },
      async save(content, expectedSha256) {
        return (await rpc.call("writeFile", {
          ...resolved,
          content,
          ...(expectedSha256 !== undefined ? { expectedSha256 } : {}),
        })) as SaveResult;
      },
    };
  }, [path, resolved, rpc]);

  if (resolveError !== null) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {resolveError} — use the tab's "Open with" menu to switch back to the
        built-in preview.
      </div>
    );
  }
  if (target === null) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <NoteEditorPane target={target} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "notes",
    title: "Notes",
    icon: "FileText",
    path: "notes",
    chrome: "none",
    component: NotesPanel,
  });
  app.slots.threadPanelAction({
    id: "note",
    title: "Open note",
    icon: "FileText",
    component: NotePanelTab,
  });
  app.slots.fileOpener({
    id: "editor",
    title: "Notes editor",
    extensions: ["md", "mdx", "markdown"],
    component: NotesFileOpener,
  });
});
