import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ThreadType } from "@bb/domain";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { ResolvedAppIcon } from "./AppIcon";
import {
  useFileSearchSuggestions,
  type AppSearchSuggestion,
  type FilePathSearchSuggestion,
  type FileSearchSuggestion,
} from "@/hooks/useFileSearchSuggestions";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import type { FileSearchSelection } from "./useThreadFileTabs";
import {
  getRecentItemName,
  resolveRecentFileKind,
  useThreadRecentItems,
  THREAD_RECENT_ITEMS_VISIBLE_LIMIT,
  type RecentFileChip,
  type ThreadRecentItem,
} from "./threadRecentItems";
import { cn } from "@/lib/utils";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { formatRelativeTime } from "@/lib/relative-time";
import { isPromptDraftEmpty, type PromptDraftState } from "@/lib/prompt-draft";

export const CREATE_APP_PROMPT_TEMPLATE = `You are creating a new bb app for this thread.

Apps system reference — run \`bb guide app\` for full detail. Layout:
- apps/<id>/manifest.json — { manifestVersion: 1, id, name, icon | logo.svg, entry, contributions: ["thread.app"], capabilities: ["data"?, "message"?] }
- apps/<id>/assets/index.html — self-contained static HTML/CSS/JS/SVG served by bb; use inline/relative files, no web server, npm, or build step
- apps/<id>/data/state.json — initial state if the app uses window.bb.data

In the page, use window.bb.data for live state (read / write / delete / list / onChange; onChange replays + streams) and window.bb.message(text) to send the thread a prompt. Guard with \`window.bb?.data?.…\` since capabilities are advisory.

Scaffold with \`bb app new\` — the default styling is wired up already, so build on top of it and keep the UI polished, accessible, and dense like the rest of bb.

What I want:

`;

const CREATE_APP_PROMPT_DRAFT = {
  text: CREATE_APP_PROMPT_TEMPLATE,
  attachments: [],
} satisfies PromptDraftState;

export interface NewTabFileSearchProps {
  projectId: string | undefined;
  environmentId: string | null;
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
  focusRequest: number;
  initialQuery?: string;
  onSelect: (selection: FileSearchSelection) => void;
  onCreateAppPromptPrefill?: CreateAppPromptPrefillHandler;
  /** Desktop-only: open a new in-panel browser tab. Absent ⇒ no Browser entry. */
  onOpenBrowser?: () => void;
}

interface AppResultRowProps {
  id: string;
  suggestion: AppSearchSuggestion;
  isActive: boolean;
  onActivate: () => void;
  onSelect: (suggestion: AppSearchSuggestion) => void;
}

interface FileResultRowProps {
  id: string;
  suggestion: FilePathSearchSuggestion;
  isActive: boolean;
  onActivate: () => void;
  onSelect: (suggestion: FilePathSearchSuggestion) => void;
}

interface RecentResultRowProps {
  id: string;
  item: ThreadRecentItem;
  isActive: boolean;
  nowMs: number;
  onActivate: () => void;
  onSelect: (item: ThreadRecentItem) => void;
}

interface FileSearchMessageProps {
  iconName: "AlertCircle" | "File" | "FileQuestion" | "Spinner";
  iconClassName?: string;
  message: string;
}

/**
 * A navigable entry in a section. Search results carry a {@link FileSearchSuggestion};
 * the synthetic Open browser / Create App actions carry no data and route to
 * their handlers; a recent entry carries the previously-opened
 * {@link ThreadRecentItem}. Keeping them in one union lets the keyboard handler
 * walk a single index space across the Apps, Open, Files, and Recent sections.
 */
type FileSearchSectionEntry =
  | { kind: "suggestion"; suggestion: FileSearchSuggestion }
  | { kind: "open-browser" }
  | { kind: "create-app" }
  | { kind: "recent"; item: ThreadRecentItem };

interface FileSearchSectionItem {
  entry: FileSearchSectionEntry;
  index: number;
}

interface FileSearchSection {
  kind: FileSearchSectionKind;
  label: string;
  items: FileSearchSectionItem[];
}

interface SplitPathResult {
  name: string;
  directory: string;
}

type SearchInputKeyDownHandler = (
  event: KeyboardEvent<HTMLInputElement>,
) => void;
type CreateAppPromptPrefillHandler = () => void;
type FileSearchSource = FileSearchSuggestion["source"];
type FileSearchSectionKind = "apps" | "open" | "files" | "recent";

interface GetAvailableFileSearchSourcesArgs {
  projectId: string | undefined;
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
}

interface GroupFileSearchSectionsArgs {
  suggestions: readonly FileSearchSuggestion[];
  availableSources: readonly FileSearchSource[];
  includeOpenBrowserEntry: boolean;
  includeCreateAppEntry: boolean;
  recentEntries: readonly FileSearchSectionEntry[];
}

interface LauncherTileProps {
  id: string;
  isActive: boolean;
  onActivate: () => void;
  onSelect: () => void;
  title?: string;
  children: ReactNode;
}

interface CreateAppTileProps {
  id: string;
  isActive: boolean;
  onActivate: () => void;
  onSelect: () => void;
}

interface OpenBrowserTileProps {
  id: string;
  isActive: boolean;
  onActivate: () => void;
  onSelect: () => void;
}

const FILE_SEARCH_LIMIT = 20;
const FILE_SEARCH_SECTION_ORDER: readonly FileSearchSectionKind[] = [
  "apps",
  "open",
  "files",
  "recent",
];

const FILE_SEARCH_SECTION_LABELS = {
  apps: "Apps",
  open: "Open",
  files: "Files",
  recent: "Recent",
} satisfies Record<FileSearchSectionKind, string>;

// Substring-matched keywords that surface the "Open browser" action while the
// user is searching (it is always shown when the query is empty).
const OPEN_BROWSER_ENTRY_KEYWORDS = "open browser web url tab";

const FILE_SEARCH_SOURCE_LABELS = {
  app: "App",
  workspace: "Workspace",
  "thread-storage": "Manager Storage",
} satisfies Record<FileSearchSource, string>;

const CREATE_APP_ENTRY_ID = "file-search-result-create-app";
const OPEN_BROWSER_ENTRY_ID = "file-search-result-open-browser";

const SECTION_HEADER_CLASS =
  "sticky top-0 z-10 bg-background px-1 pb-2 text-xs font-medium uppercase tracking-wider text-subtle-foreground";
const LAUNCHER_TILE_BASE_CLASS =
  "group flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const LAUNCHER_TILE_ICON_CLASS =
  "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-hairline bg-surface-raised";
const LAUNCHER_TILE_ICON_CLASS_DASHED =
  "flex size-9 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-surface-raised text-muted-foreground group-hover:text-foreground";

// File-type identity comes from the glyph alone — the chip stays neutral
// (shared `LAUNCHER_TILE_ICON_CLASS`) so recent rows match the app/Open-browser
// tiles without per-type coloring.
const RECENT_CHIP_ICON_NAME = {
  md: "FileText",
  html: "AppWindow",
  report: "ChartColumn",
  code: "Code",
} satisfies Record<RecentFileChip, IconName>;
const RECENT_ENTRY_ID_PREFIX = "file-search-result-recent";

function slugifyAppName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getAvailableFileSearchSources({
  projectId,
  currentThreadId,
  currentThreadType,
}: GetAvailableFileSearchSourcesArgs): readonly FileSearchSource[] {
  const sources: FileSearchSource[] = [];
  if (currentThreadId.length > 0) {
    sources.push("app");
  }
  if (projectId) {
    sources.push("workspace");
  }
  if (currentThreadType === "manager" && currentThreadId.length > 0) {
    sources.push("thread-storage");
  }
  return sources;
}

function getFileSearchResultId(suggestion: FileSearchSuggestion): string {
  const idSegment =
    suggestion.entryKind === "app" ? suggestion.appId : suggestion.path;
  return `file-search-result-${suggestion.source}-${encodeURIComponent(
    idSegment,
  )}`;
}

function getFileSearchEntryId(entry: FileSearchSectionEntry): string {
  if (entry.kind === "create-app") {
    return CREATE_APP_ENTRY_ID;
  }
  if (entry.kind === "open-browser") {
    return OPEN_BROWSER_ENTRY_ID;
  }
  if (entry.kind === "recent") {
    return `${RECENT_ENTRY_ID_PREFIX}-${entry.item.source}-${encodeURIComponent(
      entry.item.path,
    )}`;
  }
  return getFileSearchResultId(entry.suggestion);
}

function recentItemMatchesQuery(
  item: ThreadRecentItem,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }
  const { label } = resolveRecentFileKind(item.path);
  return `${getRecentItemName(item.path)} ${label} ${item.path}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function splitPath(path: string): SplitPathResult {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return { name: path, directory: "" };
  }
  return {
    name: path.slice(lastSlash + 1),
    directory: path.slice(0, lastSlash),
  };
}

function getFileSearchResultTitle(suggestion: FileSearchSuggestion): string {
  if (suggestion.entryKind === "app") {
    return `${FILE_SEARCH_SOURCE_LABELS.app}: ${suggestion.name}`;
  }
  return `${FILE_SEARCH_SOURCE_LABELS[suggestion.source]}: ${suggestion.path}`;
}

function getFileSearchSectionKind(
  suggestion: FileSearchSuggestion,
): FileSearchSectionKind {
  return suggestion.entryKind === "app" ? "apps" : "files";
}

function groupFileSearchSections({
  availableSources,
  includeOpenBrowserEntry,
  includeCreateAppEntry,
  recentEntries,
  suggestions,
}: GroupFileSearchSectionsArgs): FileSearchSection[] {
  const allowedSources = new Set<FileSearchSource>(availableSources);
  const sectionsByKind = new Map<FileSearchSectionKind, FileSearchSection>();

  const ensureSection = (
    sectionKind: FileSearchSectionKind,
  ): FileSearchSection => {
    const existing = sectionsByKind.get(sectionKind);
    if (existing) {
      return existing;
    }
    const created: FileSearchSection = {
      kind: sectionKind,
      label: FILE_SEARCH_SECTION_LABELS[sectionKind],
      items: [],
    };
    sectionsByKind.set(sectionKind, created);
    return created;
  };

  for (const suggestion of suggestions) {
    if (!allowedSources.has(suggestion.source)) {
      continue;
    }
    ensureSection(getFileSearchSectionKind(suggestion)).items.push({
      entry: { kind: "suggestion", suggestion },
      index: 0,
    });
  }

  // "Create App…" trails the Apps results — it's an app-creation action, so it
  // belongs with the apps rather than in the Open section.
  if (includeCreateAppEntry) {
    ensureSection("apps").items.push({
      entry: { kind: "create-app" },
      index: 0,
    });
  }

  // The OPEN section holds the standing "Open browser" action, kept separate
  // from the Apps results above.
  if (includeOpenBrowserEntry) {
    ensureSection("open").items.push({
      entry: { kind: "open-browser" },
      index: 0,
    });
  }

  // Recent rows trail the Apps and Files sections so the unified index space
  // reads top-down: launch an app, open a new surface, then jump back to a
  // recently-opened file.
  for (const entry of recentEntries) {
    ensureSection("recent").items.push({ entry, index: 0 });
  }

  let nextIndex = 0;
  return FILE_SEARCH_SECTION_ORDER.flatMap((sectionKind) => {
    const section = sectionsByKind.get(sectionKind);
    if (!section) {
      return [];
    }
    return [
      {
        ...section,
        items: section.items.map(({ entry }) => {
          const index = nextIndex;
          nextIndex += 1;
          return { entry, index };
        }),
      },
    ];
  });
}

function FileSearchMessage({
  iconName,
  iconClassName,
  message,
}: FileSearchMessageProps) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-raised px-3 py-6 text-center text-sm text-muted-foreground">
      <div className="flex max-w-64 flex-col items-center gap-2">
        <Icon name={iconName} className={cn("size-4", iconClassName)} />
        <p>{message}</p>
      </div>
    </div>
  );
}

/**
 * Shared button shell for the Apps-section launcher tiles (app rows and the
 * Create App action). Centralizing it keeps the listbox option/keyboard
 * contract — `role="option"`, `aria-selected`, `id`, hover-to-activate —
 * identical across every navigable tile.
 */
function LauncherTile({
  id,
  isActive,
  onActivate,
  onSelect,
  title,
  children,
}: LauncherTileProps) {
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={isActive}
      onClick={onSelect}
      onMouseEnter={onActivate}
      title={title}
      className={cn(
        LAUNCHER_TILE_BASE_CLASS,
        "scroll-mt-7",
        isActive ? "bg-state-active" : "hover:bg-state-hover",
      )}
    >
      {children}
    </button>
  );
}

function AppResultRow({
  id,
  suggestion,
  isActive,
  onActivate,
  onSelect,
}: AppResultRowProps) {
  const handleSelect = useCallback(() => {
    onSelect(suggestion);
  }, [onSelect, suggestion]);
  const showAppId = suggestion.appId !== slugifyAppName(suggestion.name);

  return (
    <LauncherTile
      id={id}
      isActive={isActive}
      onActivate={onActivate}
      onSelect={handleSelect}
      title={getFileSearchResultTitle(suggestion)}
    >
      <span className={LAUNCHER_TILE_ICON_CLASS}>
        <ResolvedAppIcon
          icon={suggestion.app.icon}
          className="size-5 text-foreground"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {suggestion.name}
        </span>
        {showAppId ? (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {suggestion.appId}
          </span>
        ) : null}
      </span>
    </LauncherTile>
  );
}

function CreateAppTile({
  id,
  isActive,
  onActivate,
  onSelect,
}: CreateAppTileProps) {
  return (
    <LauncherTile
      id={id}
      isActive={isActive}
      onActivate={onActivate}
      onSelect={onSelect}
    >
      <span className={LAUNCHER_TILE_ICON_CLASS_DASHED}>
        <Icon name="Plus" className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          Create App…
        </span>
        <span className="truncate text-xs text-muted-foreground">
          Describe an idea, the manager builds it
        </span>
      </span>
    </LauncherTile>
  );
}

function OpenBrowserTile({
  id,
  isActive,
  onActivate,
  onSelect,
}: OpenBrowserTileProps) {
  return (
    <LauncherTile
      id={id}
      isActive={isActive}
      onActivate={onActivate}
      onSelect={onSelect}
    >
      <span className={LAUNCHER_TILE_ICON_CLASS}>
        <Icon name="Globe" className="size-5 text-foreground" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          Open browser
        </span>
        <span className="truncate text-xs text-muted-foreground">
          Open a new web browser tab
        </span>
      </span>
    </LauncherTile>
  );
}

function FileResultRow({
  id,
  suggestion,
  isActive,
  onActivate,
  onSelect,
}: FileResultRowProps) {
  const handleSelect = useCallback(() => {
    onSelect(suggestion);
  }, [onSelect, suggestion]);
  const { directory } = splitPath(suggestion.path);
  const secondaryDirectory = directory || null;

  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={isActive}
      onClick={handleSelect}
      onMouseEnter={onActivate}
      title={getFileSearchResultTitle(suggestion)}
      className={cn(
        "w-full scroll-mt-7 rounded px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isActive ? "bg-state-active" : "hover:bg-state-hover",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon
          name="File"
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="truncate">{suggestion.name}</span>
        {secondaryDirectory !== null ? (
          <TruncateStart className="text-muted-foreground [flex-shrink:9999]">
            {secondaryDirectory}
          </TruncateStart>
        ) : null}
      </div>
    </button>
  );
}

/**
 * A recently-opened file row. Shares the {@link LauncherTile} shell with the app
 * and Open-browser tiles so row height, chip size, and hover/active states line
 * up; the file-type tint colors the chip and kind label, and a right-aligned
 * relative timestamp flips to an "open" affordance on hover/selection.
 * Reopening routes through the same `onSelect` path as a file-search result.
 */
function RecentResultRow({
  id,
  item,
  isActive,
  nowMs,
  onActivate,
  onSelect,
}: RecentResultRowProps) {
  const handleSelect = useCallback(() => {
    onSelect(item);
  }, [item, onSelect]);
  const { chip, label } = resolveRecentFileKind(item.path);
  const name = getRecentItemName(item.path);
  const { directory } = splitPath(item.path);
  const relativeTime = formatRelativeTime({ timestamp: item.openedAt, now: nowMs });

  return (
    <LauncherTile
      id={id}
      isActive={isActive}
      onActivate={onActivate}
      onSelect={handleSelect}
      title={`${label}: ${item.path}`}
    >
      <span className={LAUNCHER_TILE_ICON_CLASS}>
        <Icon
          name={RECENT_CHIP_ICON_NAME[chip]}
          className="size-5 text-muted-foreground"
          aria-hidden
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0 font-medium">{label}</span>
          {directory ? (
            <>
              <span className="shrink-0 opacity-50" aria-hidden>
                ·
              </span>
              <TruncateStart className="text-muted-foreground [flex-shrink:9999]">
                {directory}
              </TruncateStart>
            </>
          ) : null}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center justify-end">
        <span
          className={cn(
            "whitespace-nowrap text-xs text-muted-foreground",
            isActive ? "hidden" : "group-hover:hidden",
          )}
        >
          {relativeTime}
        </span>
        <span
          className={cn(
            "items-center gap-1 text-xs text-subtle-foreground",
            isActive ? "flex" : "hidden group-hover:flex",
          )}
          aria-hidden
        >
          <Icon name="ArrowUpRight" className="size-3" aria-hidden />
          open
        </span>
      </span>
    </LauncherTile>
  );
}

export function NewTabFileSearch({
  projectId,
  environmentId,
  currentThreadId,
  currentThreadType,
  focusRequest,
  initialQuery = "",
  onSelect,
  onCreateAppPromptPrefill,
  onOpenBrowser,
}: NewTabFileSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isRecentExpanded, setIsRecentExpanded] = useState(false);
  // Captured once on mount: the launcher is transient, so a static "now" keeps
  // every relative timestamp consistent within a single open without ticking.
  const [nowMs] = useState(() => Date.now());
  const promptDraft = usePromptDraftStorage({
    projectId,
    threadId: currentThreadId.length > 0 ? currentThreadId : null,
  });
  const recentItems = useThreadRecentItems(
    currentThreadId.length > 0 ? currentThreadId : null,
  );
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const canPrefillCreateAppPrompt =
    promptDraft.storageKey !== null && currentThreadId.length > 0;
  const { suggestions, isLoading, isError, isDebouncing, isUnavailable } =
    useFileSearchSuggestions({
      projectId,
      query,
      limit: FILE_SEARCH_LIMIT,
      environmentId,
      currentThreadId,
      currentThreadType,
    });
  const availableSources = useMemo(
    () =>
      getAvailableFileSearchSources({
        projectId,
        currentThreadId,
        currentThreadType,
      }),
    [currentThreadId, currentThreadType, projectId],
  );
  const hasAppSuggestions = useMemo(
    () => suggestions.some((suggestion) => suggestion.entryKind === "app"),
    [suggestions],
  );
  // Mirror the visible Apps section: offer Create App when nothing is typed, or
  // when the query actually matches apps — never alongside a files-only result.
  const showCreateAppEntry =
    !isUnavailable &&
    canPrefillCreateAppPrompt &&
    (!hasQuery || hasAppSuggestions);
  // Desktop-only: the Browser entry shows when nothing is typed or the query
  // matches its keywords. `onOpenBrowser` is only wired on desktop, but gate on
  // the bridge too so it never appears on the web build.
  const showOpenBrowserEntry =
    !isUnavailable &&
    onOpenBrowser !== undefined &&
    isDesktopBrowserAvailable() &&
    (!hasQuery || OPEN_BROWSER_ENTRY_KEYWORDS.includes(trimmedQuery.toLowerCase()));
  const normalizedRecentQuery = hasQuery ? trimmedQuery.toLowerCase() : "";
  const matchingRecentItems = useMemo(
    () =>
      recentItems.filter((item) =>
        recentItemMatchesQuery(item, normalizedRecentQuery),
      ),
    [normalizedRecentQuery, recentItems],
  );
  // Collapsed to the visible cap by default; a query or "Show more" reveals the
  // rest. Recents are local, so they stay in view while apps/files load.
  const visibleRecentItems = useMemo(
    () =>
      hasQuery || isRecentExpanded
        ? matchingRecentItems
        : matchingRecentItems.slice(0, THREAD_RECENT_ITEMS_VISIBLE_LIMIT),
    [hasQuery, isRecentExpanded, matchingRecentItems],
  );
  const recentEntries = useMemo<FileSearchSectionEntry[]>(
    () => visibleRecentItems.map((item) => ({ kind: "recent", item })),
    [visibleRecentItems],
  );
  const sections = useMemo(
    () =>
      groupFileSearchSections({
        availableSources,
        includeOpenBrowserEntry: showOpenBrowserEntry,
        includeCreateAppEntry: showCreateAppEntry,
        recentEntries,
        suggestions,
      }),
    [
      availableSources,
      recentEntries,
      showCreateAppEntry,
      showOpenBrowserEntry,
      suggestions,
    ],
  );
  const navigableEntries = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.map(({ entry }) => entry),
      ),
    [sections],
  );
  const activeEntry = useMemo(
    () =>
      activeIndex >= 0 && activeIndex < navigableEntries.length
        ? (navigableEntries[activeIndex] ?? null)
        : null,
    [activeIndex, navigableEntries],
  );

  useEffect(() => {
    // Focus synchronously, then again on the next frame to win the focus race
    // against the panel/tab content mounting in the same commit, which can
    // otherwise pull focus away from the input.
    inputRef.current?.focus();
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  useEffect(() => {
    setActiveIndex(navigableEntries.length > 0 ? 0 : -1);
  }, [navigableEntries]);

  const handleAppSelect = useCallback(
    (suggestion: AppSearchSuggestion) => {
      onSelect({ source: "app", appId: suggestion.appId });
    },
    [onSelect],
  );

  const handleFileSelect = useCallback(
    (suggestion: FilePathSearchSuggestion) => {
      onSelect({ source: suggestion.source, path: suggestion.path });
    },
    [onSelect],
  );

  const handleRecentSelect = useCallback(
    (item: ThreadRecentItem) => {
      onSelect({ source: item.source, path: item.path });
    },
    [onSelect],
  );

  const handleToggleRecentExpanded = useCallback(() => {
    setIsRecentExpanded((current) => !current);
  }, []);

  const handleSuggestionSelect = useCallback(
    (suggestion: FileSearchSuggestion) => {
      if (suggestion.entryKind === "app") {
        handleAppSelect(suggestion);
        return;
      }
      handleFileSelect(suggestion);
    },
    [handleAppSelect, handleFileSelect],
  );

  const handleCreateAppPromptPrefill = useCallback(() => {
    if (!canPrefillCreateAppPrompt) {
      return;
    }

    const currentDraft = promptDraft.getCurrent();
    if (
      !isPromptDraftEmpty(currentDraft) &&
      !window.confirm(
        "Replace the current composer draft with a Create App prompt?",
      )
    ) {
      return;
    }

    promptDraft.setDraft(CREATE_APP_PROMPT_DRAFT);
    onCreateAppPromptPrefill?.();
  }, [canPrefillCreateAppPrompt, onCreateAppPromptPrefill, promptDraft]);

  const handleOpenBrowser = useCallback(() => {
    onOpenBrowser?.();
  }, [onOpenBrowser]);

  const handleInputKeyDown = useCallback<SearchInputKeyDownHandler>(
    (event) => {
      if (navigableEntries.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % navigableEntries.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          current <= 0 ? navigableEntries.length - 1 : current - 1,
        );
        return;
      }

      if (event.key === "Enter" && activeEntry) {
        event.preventDefault();
        if (activeEntry.kind === "create-app") {
          handleCreateAppPromptPrefill();
          return;
        }
        if (activeEntry.kind === "open-browser") {
          handleOpenBrowser();
          return;
        }
        if (activeEntry.kind === "recent") {
          handleRecentSelect(activeEntry.item);
          return;
        }
        handleSuggestionSelect(activeEntry.suggestion);
      }
    },
    [
      activeEntry,
      handleCreateAppPromptPrefill,
      handleOpenBrowser,
      handleRecentSelect,
      handleSuggestionSelect,
      navigableEntries.length,
    ],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          disabled={isUnavailable}
          aria-label="Search apps and files"
          aria-activedescendant={
            activeEntry ? getFileSearchEntryId(activeEntry) : undefined
          }
          placeholder={
            isUnavailable ? "No searchable source" : "Search apps and files"
          }
          className="h-8 pl-8 pr-8 text-xs focus-visible:ring-0"
        />
        {isDebouncing ? (
          <Icon
            name="Spinner"
            className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : null}
      </div>

      {isUnavailable ? (
        <FileSearchMessage
          iconName="FileQuestion"
          message="No searchable app or file source is available."
        />
      ) : (
        <NewTabResults
          activeIndex={activeIndex}
          hasQuery={hasQuery}
          isError={isError}
          isLoading={isLoading}
          nowMs={nowMs}
          onActivateIndex={setActiveIndex}
          onAppSelect={handleAppSelect}
          onCreateApp={handleCreateAppPromptPrefill}
          onOpenBrowser={handleOpenBrowser}
          onFileSelect={handleFileSelect}
          onRecentSelect={handleRecentSelect}
          recent={{
            count: matchingRecentItems.length,
            showMoreCount: Math.max(
              0,
              matchingRecentItems.length - THREAD_RECENT_ITEMS_VISIBLE_LIMIT,
            ),
            isExpanded: isRecentExpanded,
            toggleVisible:
              !hasQuery &&
              matchingRecentItems.length > THREAD_RECENT_ITEMS_VISIBLE_LIMIT,
            emptyHintVisible: !hasQuery && recentItems.length === 0,
            onToggleExpanded: handleToggleRecentExpanded,
          }}
          sections={sections}
        />
      )}
    </div>
  );
}

interface NewTabRecentState {
  count: number;
  showMoreCount: number;
  isExpanded: boolean;
  toggleVisible: boolean;
  emptyHintVisible: boolean;
  onToggleExpanded: () => void;
}

interface NewTabResultsProps {
  activeIndex: number;
  hasQuery: boolean;
  isError: boolean;
  isLoading: boolean;
  nowMs: number;
  onActivateIndex: (index: number) => void;
  onAppSelect: (suggestion: AppSearchSuggestion) => void;
  onCreateApp: () => void;
  onOpenBrowser: () => void;
  onFileSelect: (suggestion: FilePathSearchSuggestion) => void;
  onRecentSelect: (item: ThreadRecentItem) => void;
  recent: NewTabRecentState;
  sections: readonly FileSearchSection[];
}

function NewTabResults({
  activeIndex,
  hasQuery,
  isError,
  isLoading,
  nowMs,
  onActivateIndex,
  onAppSelect,
  onCreateApp,
  onOpenBrowser,
  onFileSelect,
  onRecentSelect,
  recent,
  sections,
}: NewTabResultsProps) {
  const appsSection = sections.find((section) => section.kind === "apps");
  const openSection = sections.find((section) => section.kind === "open");
  const filesSection = sections.find((section) => section.kind === "files");
  const recentSection = sections.find((section) => section.kind === "recent");
  const showAppsSection = appsSection !== undefined;
  const showOpenSection = openSection !== undefined;
  const showFilesSection = filesSection !== undefined;
  const showRecentSection = recentSection !== undefined || recent.emptyHintVisible;
  const hasSectionsAbove =
    showAppsSection || showOpenSection || showFilesSection;
  const showLoading = isLoading && !showFilesSection;
  const showError = isError && !showFilesSection && !showLoading;
  const showEmptyMessage =
    !showAppsSection &&
    !showOpenSection &&
    !showFilesSection &&
    !showRecentSection &&
    !showLoading &&
    !showError;

  if (showEmptyMessage) {
    return (
      <FileSearchMessage
        iconName={hasQuery ? "FileQuestion" : "File"}
        message={
          hasQuery
            ? "No apps or files match."
            : "Type to search apps and files."
        }
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-1">
      {appsSection ? (
        <section>
          <div className={cn(SECTION_HEADER_CLASS, "pt-0")}>
            {FILE_SEARCH_SECTION_LABELS.apps}
          </div>
          <div
            role="listbox"
            aria-label={FILE_SEARCH_SECTION_LABELS.apps}
            className="flex flex-col gap-px"
          >
            {appsSection.items.map(({ entry, index }) => {
              if (entry.kind === "create-app") {
                return (
                  <CreateAppTile
                    key="create-app"
                    id={getFileSearchEntryId(entry)}
                    isActive={index === activeIndex}
                    onActivate={() => onActivateIndex(index)}
                    onSelect={onCreateApp}
                  />
                );
              }
              if (
                entry.kind !== "suggestion" ||
                entry.suggestion.entryKind !== "app"
              ) {
                return null;
              }
              const suggestion = entry.suggestion;
              return (
                <AppResultRow
                  key={`app:${suggestion.appId}`}
                  id={getFileSearchEntryId(entry)}
                  suggestion={suggestion}
                  isActive={index === activeIndex}
                  onActivate={() => onActivateIndex(index)}
                  onSelect={onAppSelect}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {openSection ? (
        <section className={cn(showAppsSection && "mt-3")}>
          <div className={cn(SECTION_HEADER_CLASS, showAppsSection && "pt-2")}>
            {FILE_SEARCH_SECTION_LABELS.open}
          </div>
          <div
            role="listbox"
            aria-label={FILE_SEARCH_SECTION_LABELS.open}
            className="flex flex-col gap-px"
          >
            {openSection.items.map(({ entry, index }) => {
              if (entry.kind !== "open-browser") {
                return null;
              }
              return (
                <OpenBrowserTile
                  key="open-browser"
                  id={getFileSearchEntryId(entry)}
                  isActive={index === activeIndex}
                  onActivate={() => onActivateIndex(index)}
                  onSelect={onOpenBrowser}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {showFilesSection && filesSection ? (
        <section className={cn((showAppsSection || showOpenSection) && "mt-3")}>
          <div
            className={cn(
              SECTION_HEADER_CLASS,
              (showAppsSection || showOpenSection) && "pt-2",
            )}
          >
            {FILE_SEARCH_SECTION_LABELS.files}
          </div>
          <div
            role="listbox"
            aria-label={FILE_SEARCH_SECTION_LABELS.files}
            className="flex flex-col gap-px"
          >
            {filesSection.items.map(({ entry, index }) => {
              if (
                entry.kind !== "suggestion" ||
                entry.suggestion.entryKind !== "file"
              ) {
                return null;
              }
              const suggestion = entry.suggestion;
              return (
                <FileResultRow
                  key={`${suggestion.source}:${suggestion.path}`}
                  id={getFileSearchEntryId(entry)}
                  suggestion={suggestion}
                  isActive={index === activeIndex}
                  onActivate={() => onActivateIndex(index)}
                  onSelect={onFileSelect}
                />
              );
            })}
          </div>
        </section>
      ) : showLoading || showError ? (
        <div className={cn((showAppsSection || showOpenSection) && "mt-3")}>
          <FileSearchMessage
            iconName={showError ? "AlertCircle" : "Spinner"}
            iconClassName={showLoading ? "animate-spin" : undefined}
            message={
              showError
                ? "App and file search failed."
                : "Searching apps and files..."
            }
          />
        </div>
      ) : null}

      {showRecentSection ? (
        <section className={cn(hasSectionsAbove && "mt-3")}>
          <div
            className={cn(
              SECTION_HEADER_CLASS,
              "flex items-baseline gap-2",
              hasSectionsAbove && "pt-2",
            )}
          >
            <span>{FILE_SEARCH_SECTION_LABELS.recent}</span>
            {recent.count > 0 ? (
              <span className="font-mono text-xs font-normal tracking-normal normal-case text-muted-foreground opacity-80">
                {recent.count}
              </span>
            ) : null}
          </div>
          {recentSection ? (
            <div
              role="listbox"
              aria-label={FILE_SEARCH_SECTION_LABELS.recent}
              className="flex flex-col gap-px"
            >
              {recentSection.items.map(({ entry, index }) => {
                if (entry.kind !== "recent") {
                  return null;
                }
                return (
                  <RecentResultRow
                    key={`recent:${entry.item.source}:${entry.item.path}`}
                    id={getFileSearchEntryId(entry)}
                    item={entry.item}
                    isActive={index === activeIndex}
                    nowMs={nowMs}
                    onActivate={() => onActivateIndex(index)}
                    onSelect={onRecentSelect}
                  />
                );
              })}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border bg-surface-raised px-3 py-4 text-center text-xs text-muted-foreground">
              Nothing referenced yet — plans, mockups, and files you open will
              show up here.
            </p>
          )}
          {recent.toggleVisible ? (
            <button
              type="button"
              aria-expanded={recent.isExpanded}
              onClick={recent.onToggleExpanded}
              className="ml-1.5 mt-0.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
            >
              <Icon
                name="ChevronDown"
                className={cn(
                  "size-3.5 transition-transform",
                  recent.isExpanded && "rotate-180",
                )}
                aria-hidden
              />
              <span>
                {recent.isExpanded
                  ? "Show less"
                  : `Show ${recent.showMoreCount} more`}
              </span>
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
