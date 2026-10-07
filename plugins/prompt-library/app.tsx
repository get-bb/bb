import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS } from "@/components/ui/hover-reveal";
import { cn } from "@/lib/utils";
import {
  definePluginApp,
  experimental_usePluginId,
  Markdown,
  useBbContext,
  useComposer,
  useRpc,
  type ComposerDraft,
  type ComposerDraftReplacement,
  type ComposerInsertPart,
  type PluginComposerScope,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import {
  promptScopeSchema,
  type PromptScope,
  type PromptSnippet,
  type RecentPromptRow,
  type StarredPromptRow,
  type promptLibraryRpcContract,
} from "./contract.js";

const POPUP_ID = "prompt-library";

type SearchResult = StandardSchemaV1InferOutput<
  (typeof promptLibraryRpcContract)["search"]["output"]
>;

type ComposerKind = "new-thread" | "follow-up";

type Row =
  | { kind: "star-draft"; key: string }
  | { kind: "starred"; key: string; row: StarredPromptRow }
  | { kind: "recent"; key: string; row: RecentPromptRow };

const TWO_PANE_MIN_WIDTH = 560;
const SEARCH_TIMEOUT_MS = 5_000;

const SCOPE_LABELS: Record<PromptScope, string> = {
  thread: "Thread",
  project: "Project",
  global: "All",
};

function composerKind(scope: PluginComposerScope): ComposerKind {
  return scope.kind === "new-thread" ? "new-thread" : "follow-up";
}

function scopesFor(kind: ComposerKind): PromptScope[] {
  return kind === "new-thread"
    ? ["project", "global"]
    : ["thread", "project", "global"];
}

function scopeStorageKey(pluginId: string, kind: ComposerKind): string {
  return `${pluginId}:scope:${kind}`;
}

function readStickyScope(pluginId: string, kind: ComposerKind): PromptScope {
  const stored = promptScopeSchema.safeParse(
    window.localStorage.getItem(scopeStorageKey(pluginId, kind)),
  );
  return stored.success && scopesFor(kind).includes(stored.data)
    ? stored.data
    : "global";
}

function scopeTargets(
  scope: PluginComposerScope,
  contextProjectId: string | null,
): { projectId: string | null; threadId: string | null } {
  switch (scope.kind) {
    case "thread":
    case "queued-message":
      return { projectId: contextProjectId, threadId: scope.threadId };
    case "new-thread":
      return { projectId: scope.projectId, threadId: null };
  }
}

function formatAge(timestamp: number, now: number): string {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function isStarShortcut(event: ReactKeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === "s" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

function insertParts(prompt: ComposerDraft): ComposerInsertPart[] {
  const parts: ComposerInsertPart[] = [];
  let cursor = 0;
  for (const mention of [...prompt.mentions].sort(
    (left, right) => left.from - right.from,
  )) {
    if (mention.from < cursor) continue;
    if (mention.from > cursor)
      parts.push(prompt.text.slice(cursor, mention.from));
    parts.push(mention);
    cursor = mention.to;
  }
  if (cursor < prompt.text.length) parts.push(prompt.text.slice(cursor));
  return parts;
}

function Snippet({ snippet }: { snippet: PromptSnippet }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of snippet.highlights) {
    if (start > cursor) parts.push(snippet.text.slice(cursor, start));
    parts.push(
      <span key={start} className="font-semibold text-foreground">
        {snippet.text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  parts.push(snippet.text.slice(cursor));
  return <span className="w-full truncate text-foreground">{parts}</span>;
}

function SectionHeader({ children }: { children: string }) {
  return (
    <div className="sticky -top-1 z-10 bg-popover px-2 pb-1 pt-2 text-xs font-medium text-subtle-foreground">
      {children}
    </div>
  );
}

function PromptLibraryPopup() {
  const composer = useComposer();
  const rpc = useRpc<typeof promptLibraryRpcContract>();
  const pluginId = experimental_usePluginId();
  const context = useBbContext();
  const kind = composerKind(composer.scope);
  const targets = scopeTargets(composer.scope, context.projectId);
  const availableScopes = scopesFor(kind).filter(
    (scope) =>
      (scope !== "thread" || targets.threadId !== null) &&
      (scope !== "project" || targets.projectId !== null),
  );
  const [query, setQuery] = useState("");
  const [preferredScope, setPreferredScope] = useState(() =>
    readStickyScope(pluginId, kind),
  );
  const scope = availableScopes.includes(preferredScope)
    ? preferredScope
    : "global";
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [isSearching, setIsSearching] = useState(true);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [twoPane, setTwoPane] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const measure = () =>
      setTwoPane(root.getBoundingClientRect().width >= TWO_PANE_MIN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let pending = true;
    let timeout: number | undefined;
    const finish = (apply: () => void) => {
      if (!pending) return;
      pending = false;
      window.clearTimeout(timeout);
      setIsSearching(false);
      apply();
    };
    const handle = window.setTimeout(
      async () => {
        setIsSearching(true);
        setError(null);
        timeout = window.setTimeout(
          () => finish(() => setError("Loading prompts timed out. Try again.")),
          SEARCH_TIMEOUT_MS,
        );
        try {
          const next = await rpc.call("search", {
            query,
            scope,
            projectId: targets.projectId,
            threadId: targets.threadId,
          });
          finish(() => setResult(next));
        } catch (cause: unknown) {
          finish(() =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }
      },
      query.length === 0 ? 0 : 60,
    );
    return () => {
      pending = false;
      window.clearTimeout(handle);
      window.clearTimeout(timeout);
    };
  }, [query, reloadCount, rpc, scope, targets.projectId, targets.threadId]);

  const draftText = composer.draft.text.trim();
  const draftIsStarred =
    result?.starred.some((row) => row.prompt.text.trim() === draftText) ??
    false;
  const rows: Row[] = [
    ...(draftText.length > 0 && !draftIsStarred && query.length === 0
      ? [{ kind: "star-draft", key: "star-draft" } as const]
      : []),
    ...(result?.starred ?? []).map(
      (row) => ({ kind: "starred", key: `starred:${row.id}`, row }) as const,
    ),
    ...(result?.recent ?? []).map(
      (row) => ({ kind: "recent", key: `recent:${row.id}`, row }) as const,
    ),
  ];
  const activeIndex = Math.max(
    rows.findIndex((row) => row.key === highlightedKey),
    0,
  );
  const activeRow = rows[activeIndex];
  const activeKey = activeRow?.key ?? null;
  if (highlightedKey !== activeKey) setHighlightedKey(activeKey);
  const previewRow = twoPane
    ? activeRow
    : rows.find((row) => row.key === previewKey);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const reload = () => setReloadCount((count) => count + 1);

  const changeScope = (next: PromptScope) => {
    setPreferredScope(next);
    setHighlightedKey(null);
    window.localStorage.setItem(scopeStorageKey(pluginId, kind), next);
  };

  const starPrompt = ({ text, mentions }: ComposerDraft) => {
    rpc
      .call("star", { prompt: { text, mentions } })
      .then(reload)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  };

  const unstar = (id: string) => {
    rpc
      .call("unstar", { id })
      .then(reload)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  };

  const toggleStar = (row: Row) => {
    if (row.kind === "star-draft") {
      starPrompt(composer.draft);
    } else if (row.kind === "starred") {
      unstar(row.row.id);
    } else if (row.row.starredId !== null) {
      unstar(row.row.starredId);
    } else {
      starPrompt(row.row.prompt);
    }
  };

  const insertPrompt = (prompt: ComposerDraftReplacement) => {
    if (composer.isEmpty) {
      composer.replace({
        text: prompt.text,
        mentions: prompt.mentions,
        attachments: prompt.attachments ?? [],
      });
    } else {
      composer.insert(insertParts(prompt));
    }
    composer.experimental_closePopup();
  };

  const activate = (row: Row) => {
    if (row.kind === "star-draft") {
      starPrompt(composer.draft);
      return;
    }
    if (row.kind === "starred") {
      void rpc.call("markUsed", { id: row.row.id }).catch(() => {});
    }
    insertPrompt(row.row.prompt);
  };

  const choose = (row: Row) => {
    setHighlightedKey(row.key);
    if (row.kind === "star-draft") {
      activate(row);
    } else {
      setPreviewKey(row.key);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const row = rows[activeIndex];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = rows[(activeIndex + step + rows.length) % rows.length];
      if (next !== undefined) setHighlightedKey(next.key);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (row !== undefined) activate(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (previewKey !== null && !twoPane) {
        setPreviewKey(null);
      } else {
        composer.experimental_closePopup();
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      const index = availableScopes.indexOf(scope);
      const step = event.shiftKey ? -1 : 1;
      const next =
        availableScopes[
          (index + step + availableScopes.length) % availableScopes.length
        ];
      if (next !== undefined) changeScope(next);
    } else if (isStarShortcut(event)) {
      event.preventDefault();
      if (row !== undefined) toggleStar(row);
    }
  };

  const isStarred = (row: Row) =>
    row.kind === "starred" ||
    (row.kind === "recent" && row.row.starredId !== null);

  const metaFor = (row: Row) =>
    row.kind === "recent"
      ? [
          row.row.projectId !== targets.projectId ? row.row.projectName : null,
          formatAge(row.row.createdAt, now),
        ]
          .filter((part) => part !== null)
          .join(" · ")
      : row.kind === "starred"
        ? row.row.lastUsedAt === null
          ? `Starred ${formatAge(row.row.createdAt, now)}`
          : `Used ${formatAge(row.row.lastUsedAt, now)}`
        : null;

  const renderRow = (row: Row, index: number) => {
    const selected = index === activeIndex;
    const starred = isStarred(row);
    const meta = metaFor(row);
    return (
      <div
        ref={(element) => {
          rowRefs.current[index] = element;
        }}
        role="option"
        aria-selected={selected}
        className={cn(
          "group flex items-center gap-1 rounded px-2 py-1.5 text-xs",
          selected ? "bg-state-active" : "hover:bg-state-hover",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(row)}
        >
          {row.kind === "star-draft" ? (
            <span className="flex items-center gap-1.5 text-foreground">
              <Icon name="Star" className="size-3.5 text-subtle-foreground" />
              Star current draft
            </span>
          ) : (
            <Snippet snippet={row.row.snippet} />
          )}
          {meta === null ? null : (
            <span className="w-full truncate text-2xs text-subtle-foreground">
              {meta}
            </span>
          )}
        </button>
        {row.kind === "star-draft" ? null : (
          <button
            type="button"
            aria-label={starred ? "Unstar" : "Star prompt"}
            aria-pressed={starred}
            title={starred ? "Unstar" : "Star prompt"}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded text-subtle-foreground hover:text-foreground",
              !selected && [
                "opacity-0 group-hover:opacity-100",
                HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS,
              ],
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleStar(row)}
          >
            <Icon
              name="Star"
              className={cn("size-3.5", starred && "fill-current")}
            />
          </button>
        )}
      </div>
    );
  };

  const starredStart = rows.findIndex((row) => row.kind === "starred");
  const recentStart = rows.findIndex((row) => row.kind === "recent");

  const renderPreview = (row: Row) => {
    const starred = isStarred(row);
    const content =
      row.kind === "star-draft" ? composer.draft.text : row.row.prompt.text;
    const meta = metaFor(row);
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label="Prompt preview"
        role="region"
      >
        {twoPane ? null : (
          <div className="flex items-center border-b border-border px-1 py-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setPreviewKey(null)}
            >
              <Icon name="ArrowLeft" className="size-3.5" />
              Back
            </button>
          </div>
        )}
        <div key={row.key} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <Markdown content={content} className="text-sm" />
        </div>
        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-subtle-foreground">
            {meta ?? `${content.length.toLocaleString()} characters`}
          </span>
          {row.kind === "star-draft" ? (
            <button
              type="button"
              className="rounded bg-state-active px-2 py-1 text-xs text-foreground hover:bg-state-hover"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => activate(row)}
            >
              Star draft
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={starred}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleStar(row)}
              >
                <Icon
                  name="Star"
                  className={cn("size-3.5", starred && "fill-current")}
                />
                {starred ? "Starred" : "Star"}
              </button>
              <button
                type="button"
                className="rounded bg-state-active px-2 py-1 text-xs text-foreground hover:bg-state-hover"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => activate(row)}
              >
                Insert
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const showList = twoPane || previewRow === undefined;

  return (
    <div ref={rootRef} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Icon
          name="Search"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <input
          autoFocus
          aria-label="Search prompts"
          aria-controls="prompt-library-results"
          placeholder="Search prompts"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlightedKey(null);
          }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div
          role="radiogroup"
          aria-label="Search scope"
          className="flex shrink-0 items-center gap-0.5"
        >
          {availableScopes.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === scope}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs",
                option === scope
                  ? "bg-state-active text-foreground"
                  : "text-muted-foreground hover:bg-state-hover",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => changeScope(option)}
            >
              {SCOPE_LABELS[option]}
            </button>
          ))}
        </div>
      </div>
      {isSearching ? (
        <div role="status" className="px-3 py-2 text-xs text-muted-foreground">
          {result === null ? "Loading prompts…" : "Searching prompts…"}
        </div>
      ) : null}
      {error !== null ? (
        <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs">
          <span className="flex-1 text-destructive">{error}</span>
          <button
            type="button"
            className="rounded px-2 py-1 text-foreground hover:bg-state-hover"
            onMouseDown={(event) => event.preventDefault()}
            onClick={reload}
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="flex h-80 min-h-0">
        {showList ? (
          <div
            id="prompt-library-results"
            role="listbox"
            aria-label="Prompts"
            className={cn(
              "min-h-0 overflow-y-auto p-1",
              twoPane ? "w-2/5 shrink-0 border-r border-border" : "flex-1",
            )}
          >
            {result === null ? null : rows.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No prompts found
              </div>
            ) : (
              rows.map((row, index) => (
                <Fragment key={row.key}>
                  {index === starredStart ? (
                    <SectionHeader>Starred</SectionHeader>
                  ) : null}
                  {index === recentStart ? (
                    <SectionHeader>Recent</SectionHeader>
                  ) : null}
                  {renderRow(row, index)}
                </Fragment>
              ))
            )}
          </div>
        ) : null}
        {previewRow !== undefined ? renderPreview(previewRow) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: POPUP_ID,
    experimental_popups: [
      { id: POPUP_ID, label: "Prompts…", component: PromptLibraryPopup },
    ],
    plusMenu: [
      {
        id: "open",
        label: "Prompts…",
        icon: "Clock",
        run: ({ composer }) => {
          composer.experimental_openPopup(POPUP_ID);
        },
      },
    ],
  });
  app.composer.experimental_registerCommand({
    id: "search-prompts",
    title: "Search prompts",
    defaultShortcut: { key: "r", control: true },
    run: ({ composer }) => {
      composer.experimental_openPopup(POPUP_ID);
    },
  });
});
