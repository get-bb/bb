import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { directoryFromPath } from "@bb/thread-view";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { Icon } from "@/components/ui/icon.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Input } from "@/components/ui/input.js";
import { Separator } from "@/components/ui/separator.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { ResolvedAppIcon } from "./AppIcon";
import {
  useFileSearchSuggestions,
  type AppSearchSuggestion,
  type FilePathSearchSuggestion,
  type FileSearchSuggestion,
} from "@/hooks/useFileSearchSuggestions";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { useApps } from "@/hooks/queries/thread-queries";
import type { FileSearchSelection } from "./useThreadFileTabs";
import {
  useThreadRecentItems,
  THREAD_RECENT_ITEMS_VISIBLE_LIMIT,
  type ThreadRecentItem,
} from "./threadRecentItems";
import {
  getFileNameFromPath,
  resolveRightPanelFileVisual,
} from "./rightPanelFileVisuals";
import { cn } from "@/lib/utils";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { isProjectlessProjectId } from "@/lib/app-route-paths";
import { formatRelativeTime } from "@/lib/relative-time";
import { isPromptDraftEmpty, type PromptDraftState } from "@/lib/prompt-draft";
import {
  LAUNCHER_MENU_ROW_BASE_CLASS,
  LAUNCHER_ROW_BASE_CLASS,
  LAUNCHER_ROW_ICON_CLASS,
  LauncherRowTrailing,
  LauncherSectionHeader,
} from "./launcherRow";

export const CREATE_APP_PROMPT_TEMPLATE = `You are creating a new global bb app.

Apps system reference — run \`bb guide app\` for full detail. Layout:
- <dataDir>/apps/<applicationId>/manifest.json — { manifestVersion: 1, id: applicationId, name?, icon | logo.svg, entry, capabilities: ["data"?, "message"?] }
- <dataDir>/apps/<applicationId>/README.md — scaffold notes and build instructions
- <dataDir>/apps/<applicationId>/public/index.html — prebuilt static web root served by bb; use flat relative asset refs
- <dataDir>/apps/<applicationId>/data/state.json — empty seed state; app data can also use nested records such as todos/<id>
- <dataDir>/apps/<applicationId>/skills/add-todos/SKILL.md — scaffold skill showing the Todo record shape
- <dataDir>/apps/<applicationId>/source/ — editable Vite + React + TypeScript project; run \`pnpm install\` and \`pnpm build\` here after edits

In the page, use the injected window.bb SDK: window.bb.data.read({ path }), window.bb.data.write({ path, value }), window.bb.data.delete({ path }), window.bb.data.list({ prefix }), window.bb.data.onChange({ prefix, callback }) for live state, and window.bb.message.send({ payload }) to send the thread a prompt.

Scaffold with \`bb app new --name "Name"\` or \`bb app new --slug my-app\`; new apps open immediately from committed \`public/\`. Edit \`source/\`, rebuild to \`public/\`, and do not rely on a localhost dev server for the installed app. Inside an app-capable runtime, inspect \`bb app current --json\` and write directly to \`BB_APP_ROOT\` / \`BB_APP_DATA_PATH\`. The application id is the lowercase slug folder name; display names are optional labels, not identifiers.

What I want:

`;

const CREATE_APP_PROMPT_DRAFT = {
  text: CREATE_APP_PROMPT_TEMPLATE,
  mentions: [],
  attachments: [],
} satisfies PromptDraftState;

export interface NewTabFileSearchProps {
  projectId: string | undefined;
  environmentId: string | null;
  currentThreadId: string;
  focusRequest: number;
  initialQuery?: string;
  onSelect: (selection: FileSearchSelection) => void;
}

export interface NewTabActionMenuProps {
  projectId: string | undefined;
  environmentId: string | null;
  currentThreadId: string;
  onSelect: (selection: FileSearchSelection) => void;
  onOpenFileSearch: () => void;
  onCreateAppPromptPrefill?: CreateAppPromptPrefillHandler;
  /** Desktop-only: open a new in-panel browser tab. Absent ⇒ no Browser entry. */
  onOpenBrowser?: () => void;
  onStartTerminal?: () => void;
  onCloseMenu: () => void;
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
 * a recent entry carries the previously-opened {@link ThreadRecentItem}. The
 * file-search screen keeps both in one union so the keyboard handler can walk a
 * single index space across Files and Recent sections.
 */
type FileSearchSectionEntry =
  | { kind: "suggestion"; suggestion: FileSearchSuggestion }
  | { kind: "open-browser" }
  | { kind: "open-file" }
  | { kind: "start-terminal" }
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

type LauncherKeyDownHandler = (event: KeyboardEvent<HTMLElement>) => void;
type CreateAppPromptPrefillHandler = () => void;
type FileSearchSource = FileSearchSuggestion["source"];
type FileSearchSectionKind = "actions" | "apps" | "files" | "recent";
type CreateAppEntryPlacement = "actions" | "apps" | "none";
type LauncherTileVariant = "result" | "menu";

interface GetAvailableFileSearchSourcesArgs {
  projectId: string | undefined;
  environmentId: string | null;
  currentThreadId: string;
}

interface GroupFileSearchSectionsArgs {
  suggestions: readonly FileSearchSuggestion[];
  availableSources: readonly FileSearchSource[];
  includeOpenBrowserEntry: boolean;
  includeOpenFileEntry: boolean;
  includeStartTerminalEntry: boolean;
  includeCreateAppEntry: boolean;
  createAppPlacement: CreateAppEntryPlacement;
  recentEntries: readonly FileSearchSectionEntry[];
}

interface LauncherTileProps {
  id: string;
  isActive: boolean;
  variant?: LauncherTileVariant;
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

interface OpenFileTileProps {
  id: string;
  isActive: boolean;
  onActivate: () => void;
  onSelect: () => void;
}

interface StartTerminalTileProps {
  id: string;
  isActive: boolean;
  onActivate: () => void;
  onSelect: () => void;
}

const FILE_SEARCH_LIMIT = 20;
const FILE_SEARCH_SECTION_ORDER: readonly FileSearchSectionKind[] = [
  "apps",
  "actions",
  "files",
  "recent",
];

const FILE_SEARCH_SECTION_LABELS = {
  actions: "Actions",
  apps: "Apps",
  files: "Files",
  recent: "Recent",
} satisfies Record<FileSearchSectionKind, string>;

const FILE_SEARCH_SOURCE_LABELS = {
  app: "App",
  workspace: "Workspace",
  "thread-storage": "Thread storage",
} satisfies Record<FileSearchSource, string>;

const CREATE_APP_ENTRY_ID = "file-search-result-create-app";
const OPEN_BROWSER_ENTRY_ID = "file-search-result-open-browser";
const OPEN_FILE_ENTRY_ID = "file-search-result-open-file";
const START_TERMINAL_ENTRY_ID = "file-search-result-start-terminal";

const LAUNCHER_TILE_ICON_CLASS_DASHED = `flex shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground ${COARSE_POINTER_ICON_SIZE_CLASS}`;
const NEW_TAB_ACTION_MENU_SEPARATOR_CLASS = "mx-2 my-1.5 w-auto bg-border-seam";

const RECENT_ENTRY_ID_PREFIX = "file-search-result-recent";

function getAvailableFileSearchSources({
  projectId,
  environmentId,
  currentThreadId,
}: GetAvailableFileSearchSourcesArgs): readonly FileSearchSource[] {
  const sources: FileSearchSource[] = [];
  if (currentThreadId.length > 0) {
    sources.push("app");
  }
  // The workspace is searchable via an existing thread's environment, or via a
  // standard project's default source before any environment exists. Projectless
  // (personal) threads have no project source, so without an environment there
  // is no workspace to search. Mirrors the source selection in usePathSuggestions.
  if (
    Boolean(environmentId) ||
    (projectId && !isProjectlessProjectId(projectId))
  ) {
    sources.push("workspace");
  }
  if (currentThreadId.length > 0) {
    sources.push("thread-storage");
  }
  return sources;
}

function getFileSearchResultId(suggestion: FileSearchSuggestion): string {
  const idSegment =
    suggestion.entryKind === "app" ? suggestion.applicationId : suggestion.path;
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
  if (entry.kind === "open-file") {
    return OPEN_FILE_ENTRY_ID;
  }
  if (entry.kind === "start-terminal") {
    return START_TERMINAL_ENTRY_ID;
  }
  if (entry.kind === "recent") {
    return `${RECENT_ENTRY_ID_PREFIX}-${entry.item.source}-${encodeURIComponent(
      entry.item.path,
    )}`;
  }
  return getFileSearchResultId(entry.suggestion);
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
  includeOpenFileEntry,
  includeStartTerminalEntry,
  includeCreateAppEntry,
  createAppPlacement,
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

  if (includeCreateAppEntry && createAppPlacement !== "none") {
    ensureSection(createAppPlacement).items.push({
      entry: { kind: "create-app" },
      index: 0,
    });
  }

  if (includeOpenBrowserEntry) {
    ensureSection("actions").items.push({
      entry: { kind: "open-browser" },
      index: 0,
    });
  }

  if (includeOpenFileEntry) {
    ensureSection("actions").items.push({
      entry: { kind: "open-file" },
      index: 0,
    });
  }

  if (includeStartTerminalEntry) {
    ensureSection("actions").items.push({
      entry: { kind: "start-terminal" },
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
    <EmptyStatePanel className="flex min-h-24 items-center justify-center">
      <div className="flex max-w-64 items-center justify-center gap-1.5">
        <Icon
          name={iconName}
          className={cn(
            COARSE_POINTER_ICON_SIZE_CLASS,
            "shrink-0",
            iconClassName,
          )}
        />
        <p className={COARSE_POINTER_TEXT_SM_CLASS}>{message}</p>
      </div>
    </EmptyStatePanel>
  );
}

/**
 * Shared button shell for launcher rows. File-search result rows use listbox
 * option semantics; rows in the + popout keep native button semantics because
 * the popout is a simple action list rather than a composite widget.
 */
function LauncherTile({
  id,
  isActive,
  variant = "result",
  onActivate,
  onSelect,
  title,
  children,
}: LauncherTileProps) {
  const baseClass =
    variant === "menu" ? LAUNCHER_MENU_ROW_BASE_CLASS : LAUNCHER_ROW_BASE_CLASS;

  return (
    <button
      type="button"
      id={id}
      role={variant === "result" ? "option" : undefined}
      aria-selected={variant === "result" ? isActive : undefined}
      onClick={onSelect}
      onMouseEnter={onActivate}
      title={title}
      className={cn(
        baseClass,
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
  return (
    <LauncherTile
      id={id}
      isActive={isActive}
      variant="menu"
      onActivate={onActivate}
      onSelect={handleSelect}
      title={getFileSearchResultTitle(suggestion)}
    >
      <span className={LAUNCHER_ROW_ICON_CLASS}>
        <ResolvedAppIcon
          icon={suggestion.app.icon}
          className={cn(
            COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
            "text-muted-foreground",
          )}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {suggestion.name}
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
      variant="menu"
      onActivate={onActivate}
      onSelect={onSelect}
    >
      <span className={LAUNCHER_TILE_ICON_CLASS_DASHED}>
        <Icon
          name="Plus"
          className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
          aria-hidden
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        Create App...
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
      variant="menu"
      onActivate={onActivate}
      onSelect={onSelect}
    >
      <span className={LAUNCHER_ROW_ICON_CLASS}>
        <Icon
          name="Globe"
          className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
          aria-hidden
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        Open browser
      </span>
    </LauncherTile>
  );
}

function OpenFileTile({
  id,
  isActive,
  onActivate,
  onSelect,
}: OpenFileTileProps) {
  return (
    <LauncherTile
      id={id}
      isActive={isActive}
      variant="menu"
      onActivate={onActivate}
      onSelect={onSelect}
    >
      <span className={LAUNCHER_ROW_ICON_CLASS}>
        <Icon
          name="File"
          className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
          aria-hidden
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">Open file</span>
    </LauncherTile>
  );
}

function StartTerminalTile({
  id,
  isActive,
  onActivate,
  onSelect,
}: StartTerminalTileProps) {
  return (
    <LauncherTile
      id={id}
      isActive={isActive}
      variant="menu"
      onActivate={onActivate}
      onSelect={onSelect}
    >
      <span className={LAUNCHER_ROW_ICON_CLASS}>
        <Icon
          name="Terminal"
          className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
          aria-hidden
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        Start terminal
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
  const directory = directoryFromPath(suggestion.path);
  const secondaryDirectory = directory || null;
  const visual = resolveRightPanelFileVisual({ path: suggestion.path });

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
        "w-full scroll-mt-7 rounded px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        COARSE_POINTER_TEXT_SM_CLASS,
        isActive ? "bg-state-active" : "hover:bg-state-hover",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon
          name={visual.iconName}
          className={cn(
            COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
            "text-muted-foreground",
          )}
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
 * A recently-opened file row. It uses the compact launcher shell so recents sit
 * at roughly the same density as file-search results, with the file-kind glyph
 * carried inline. Reopening routes through the same `onSelect` path as a
 * file-search result.
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
  const visual = resolveRightPanelFileVisual({ path: item.path });
  const name = getFileNameFromPath({ path: item.path });
  const directory = directoryFromPath(item.path);
  const relativeTime = formatRelativeTime({
    timestamp: item.openedAt,
    now: nowMs,
  });

  return (
    <LauncherTile
      id={id}
      isActive={isActive}
      onActivate={onActivate}
      onSelect={handleSelect}
      title={item.path}
    >
      <span className={LAUNCHER_ROW_ICON_CLASS}>
        <Icon
          name={visual.iconName}
          className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
          aria-hidden
        />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-foreground">{name}</span>
        {directory ? (
          <TruncateStart className="text-muted-foreground [flex-shrink:9999]">
            {directory}
          </TruncateStart>
        ) : null}
      </span>
      <LauncherRowTrailing idle={relativeTime} isActive={isActive} />
    </LauncherTile>
  );
}

export function NewTabFileSearch({
  projectId,
  environmentId,
  currentThreadId,
  focusRequest,
  initialQuery = "",
  onSelect,
}: NewTabFileSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isRecentExpanded, setIsRecentExpanded] = useState(false);
  // Captured once on mount: the launcher is transient, so a static "now" keeps
  // every relative timestamp consistent within a single open without ticking.
  const [nowMs] = useState(() => Date.now());
  const recentItems = useThreadRecentItems(
    currentThreadId.length > 0 ? currentThreadId : null,
  );
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const { suggestions, isLoading, fileSearchError, isDebouncing } =
    useFileSearchSuggestions({
      projectId,
      query,
      limit: FILE_SEARCH_LIMIT,
      environmentId,
      currentThreadId,
    });
  const availableSources = useMemo(
    () =>
      getAvailableFileSearchSources({
        projectId,
        environmentId,
        currentThreadId,
      }),
    [currentThreadId, environmentId, projectId],
  );
  const fileSearchSources = useMemo(
    () => availableSources.filter((source) => source !== "app"),
    [availableSources],
  );
  const fileSuggestions = useMemo(
    () =>
      suggestions.filter(
        (suggestion): suggestion is FilePathSearchSuggestion =>
          suggestion.entryKind === "file",
      ),
    [suggestions],
  );
  // Collapsed to the visible cap by default. Recents are file/artifact entries,
  // so this section is owned by the Open file/search surface rather than the +
  // action menu.
  const visibleRecentItems = useMemo(
    () =>
      isRecentExpanded
        ? recentItems
        : recentItems.slice(0, THREAD_RECENT_ITEMS_VISIBLE_LIMIT),
    [isRecentExpanded, recentItems],
  );
  const recentEntries = useMemo<FileSearchSectionEntry[]>(
    () => visibleRecentItems.map((item) => ({ kind: "recent", item })),
    [visibleRecentItems],
  );
  const sections = useMemo(
    () =>
      groupFileSearchSections({
        availableSources: fileSearchSources,
        includeOpenBrowserEntry: false,
        includeOpenFileEntry: false,
        includeStartTerminalEntry: false,
        includeCreateAppEntry: false,
        createAppPlacement: "none",
        recentEntries,
        suggestions: fileSuggestions,
      }),
    [fileSearchSources, fileSuggestions, recentEntries],
  );
  const navigableEntries = useMemo(
    () =>
      sections.flatMap((section) => section.items.map(({ entry }) => entry)),
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
      if (suggestion.entryKind === "file") {
        handleFileSelect(suggestion);
      }
    },
    [handleFileSelect],
  );

  const handleLauncherKeyDown = useCallback<LauncherKeyDownHandler>(
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
        if (activeEntry.kind === "recent") {
          handleRecentSelect(activeEntry.item);
          return;
        }
        if (activeEntry.kind === "suggestion") {
          handleSuggestionSelect(activeEntry.suggestion);
        }
      }
    },
    [
      activeEntry,
      handleRecentSelect,
      handleSuggestionSelect,
      navigableEntries.length,
    ],
  );

  const activeEntryId = activeEntry
    ? getFileSearchEntryId(activeEntry)
    : undefined;
  const isSearchDisabled = fileSearchSources.length === 0;
  // The results listbox renders only when there is a searchable source and at
  // least one option. Gate the combobox relationship on that so
  // `aria-controls`/`aria-activedescendant` never point at an absent element.
  const hasListbox = !isSearchDisabled && navigableEntries.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative min-w-0">
        <Icon
          name="Search"
          className={cn(
            "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground",
            COARSE_POINTER_ICON_SIZE_CLASS,
          )}
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleLauncherKeyDown}
          disabled={isSearchDisabled}
          // Combobox with a list autocomplete popup: one listbox holds the
          // navigable Files/Recent options, and the highlighted row is the
          // combobox's active descendant within that controlled listbox.
          role="combobox"
          aria-label="Search files"
          aria-autocomplete="list"
          aria-expanded={hasListbox}
          aria-controls={hasListbox ? listboxId : undefined}
          aria-activedescendant={hasListbox ? activeEntryId : undefined}
          placeholder={
            isSearchDisabled ? "No searchable file source" : "Search files"
          }
          className={cn(
            "h-8 pl-8 pr-8 focus-visible:ring-0 max-md:pointer-coarse:h-10",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        />
        {isDebouncing ? (
          <Icon
            name="Spinner"
            className={cn(
              "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
            )}
          />
        ) : null}
      </div>
      {fileSearchSources.length === 0 ? (
        <FileSearchMessage
          iconName="FileQuestion"
          message="No searchable file source is available."
        />
      ) : (
        <NewTabResults
          activeIndex={activeIndex}
          hasQuery={hasQuery}
          fileSearchError={fileSearchError}
          isLoading={isLoading}
          listboxId={listboxId}
          nowMs={nowMs}
          onActivateIndex={setActiveIndex}
          onFileSelect={handleFileSelect}
          onRecentSelect={handleRecentSelect}
          recent={{
            count: recentItems.length,
            showMoreCount: Math.max(
              0,
              recentItems.length - THREAD_RECENT_ITEMS_VISIBLE_LIMIT,
            ),
            isExpanded: isRecentExpanded,
            toggleVisible:
              recentItems.length > THREAD_RECENT_ITEMS_VISIBLE_LIMIT,
            emptyHintVisible: recentItems.length === 0,
            onToggleExpanded: handleToggleRecentExpanded,
          }}
          sections={sections}
        />
      )}
    </div>
  );
}

export function NewTabActionMenu({
  projectId,
  environmentId,
  currentThreadId,
  onSelect,
  onOpenFileSearch,
  onCreateAppPromptPrefill,
  onOpenBrowser,
  onStartTerminal,
  onCloseMenu,
}: NewTabActionMenuProps) {
  const promptDraft = usePromptDraftStorage({
    projectId,
    threadId: currentThreadId.length > 0 ? currentThreadId : null,
  });
  const availableSources = useMemo(
    () =>
      getAvailableFileSearchSources({
        projectId,
        environmentId,
        currentThreadId,
      }),
    [currentThreadId, environmentId, projectId],
  );
  const fileSearchSources = useMemo(
    () => availableSources.filter((source) => source !== "app"),
    [availableSources],
  );
  const canSearchApps = currentThreadId.length > 0;
  const apps = useApps({ enabled: canSearchApps });
  const appSuggestions = useMemo<AppSearchSuggestion[]>(
    () =>
      (apps.data ?? []).map((app) => ({
        source: "app",
        entryKind: "app",
        app,
        applicationId: app.applicationId,
        name: app.name,
        score: 0,
      })),
    [apps.data],
  );
  const canPrefillCreateAppPrompt =
    promptDraft.storageKey !== null && currentThreadId.length > 0;
  const isMenuUnavailable = availableSources.length === 0;
  const showOpenBrowserEntry =
    !isMenuUnavailable &&
    onOpenBrowser !== undefined &&
    isDesktopBrowserAvailable();
  const showOpenFileEntry = !isMenuUnavailable && fileSearchSources.length > 0;
  const showStartTerminalEntry =
    !isMenuUnavailable && onStartTerminal !== undefined;
  const showCreateAppEntry = !isMenuUnavailable && canPrefillCreateAppPrompt;

  const handleAppSelect = useCallback(
    (suggestion: AppSearchSuggestion) => {
      onCloseMenu();
      onSelect({ source: "app", applicationId: suggestion.applicationId });
    },
    [onCloseMenu, onSelect],
  );

  const handleOpenFileSearch = useCallback(() => {
    onCloseMenu();
    onOpenFileSearch();
  }, [onCloseMenu, onOpenFileSearch]);

  const handleOpenBrowser = useCallback(() => {
    onCloseMenu();
    onOpenBrowser?.();
  }, [onCloseMenu, onOpenBrowser]);

  const handleStartTerminal = useCallback(() => {
    onCloseMenu();
    onStartTerminal?.();
  }, [onCloseMenu, onStartTerminal]);

  const handleCreateAppPromptPrefill = useCallback(() => {
    onCloseMenu();
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
  }, [
    canPrefillCreateAppPrompt,
    onCloseMenu,
    onCreateAppPromptPrefill,
    promptDraft,
  ]);

  const hasInstalledApps = appSuggestions.length > 0;

  return (
    <div data-testid="new-tab-action-menu" className="flex min-w-0 flex-col">
      {/* Primary open actions lead the menu before installed apps. */}
      <div className="flex flex-col gap-px">
        {showOpenFileEntry ? (
          <OpenFileTile
            id={OPEN_FILE_ENTRY_ID}
            isActive={false}
            onActivate={() => undefined}
            onSelect={handleOpenFileSearch}
          />
        ) : null}
        {showOpenBrowserEntry ? (
          <OpenBrowserTile
            id={OPEN_BROWSER_ENTRY_ID}
            isActive={false}
            onActivate={() => undefined}
            onSelect={handleOpenBrowser}
          />
        ) : null}
        {showStartTerminalEntry ? (
          <StartTerminalTile
            id={START_TERMINAL_ENTRY_ID}
            isActive={false}
            onActivate={() => undefined}
            onSelect={handleStartTerminal}
          />
        ) : null}
      </div>

      {/* Installed apps get their own divided, titled section, present only
          when at least one app exists. With no apps there is no divider or
          title and Create App simply trails the open actions below. */}
      {hasInstalledApps ? (
        <>
          <Separator
            // A real (non-decorative) separator marks the boundary between the
            // open actions and the apps group, matching the app's menu divider
            // convention. Keep it inset to the row/content rail on the left,
            // and use the same subtle seam token as horizontal top-nav dividers.
            decorative={false}
            className={NEW_TAB_ACTION_MENU_SEPARATOR_CLASS}
          />
          <LauncherSectionHeader
            label={FILE_SEARCH_SECTION_LABELS.apps}
            className="pb-1"
          />
        </>
      ) : null}

      {/* Apps list, then any app-load status, then Create App. Create App is
          always the final row, so the Loading/Couldn't-load notice sits above
          it in every app state rather than trailing it. */}
      <div className="flex flex-col gap-px">
        {appSuggestions.map((suggestion) => (
          <AppResultRow
            key={`app:${suggestion.applicationId}`}
            id={getFileSearchResultId(suggestion)}
            suggestion={suggestion}
            isActive={false}
            onActivate={() => undefined}
            onSelect={handleAppSelect}
          />
        ))}
        {canSearchApps && apps.isLoading && appSuggestions.length === 0 ? (
          <p
            className={cn(
              "px-2 py-1 text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            Loading apps...
          </p>
        ) : null}
        {canSearchApps && apps.isError ? (
          <p
            className={cn(
              "px-2 py-1 text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            Couldn't load apps.
          </p>
        ) : null}
        {showCreateAppEntry ? (
          <CreateAppTile
            id={CREATE_APP_ENTRY_ID}
            isActive={false}
            onActivate={() => undefined}
            onSelect={handleCreateAppPromptPrefill}
          />
        ) : null}
      </div>
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
  fileSearchError: boolean;
  isLoading: boolean;
  /** Id of the single combobox listbox that wraps the Files/Recent option groups. */
  listboxId: string;
  nowMs: number;
  onActivateIndex: (index: number) => void;
  onFileSelect: (suggestion: FilePathSearchSuggestion) => void;
  onRecentSelect: (item: ThreadRecentItem) => void;
  recent: NewTabRecentState;
  sections: readonly FileSearchSection[];
}

function NewTabResults({
  activeIndex,
  hasQuery,
  fileSearchError,
  isLoading,
  listboxId,
  nowMs,
  onActivateIndex,
  onFileSelect,
  onRecentSelect,
  recent,
  sections,
}: NewTabResultsProps) {
  const filesSection = sections.find((section) => section.kind === "files");
  const recentSection = sections.find((section) => section.kind === "recent");
  const showFilesSection = filesSection !== undefined;
  const showRecentSection =
    recentSection !== undefined || recent.emptyHintVisible;
  const hasSectionsAbove = showFilesSection;
  const showLoading = isLoading && !showFilesSection;
  const showError = fileSearchError && !showFilesSection && !showLoading;
  const showNoFileResults =
    hasQuery && !showFilesSection && !showLoading && !showError;
  const showFileSearchMessage = showLoading || showError || showNoFileResults;
  const hasRecentSectionPredecessor = hasSectionsAbove || showFileSearchMessage;
  const showEmptyMessage =
    !showFilesSection && !showRecentSection && !showLoading && !showError;
  // The combobox popup is a single listbox spanning both groups, so the active
  // descendant the input points at always resolves inside one controlled
  // element. It renders only when a group has option rows; the loading/error
  // message, the empty-recent card, and the show-more toggle are not options
  // and stay outside the listbox.
  const showListbox = showFilesSection || recentSection !== undefined;

  if (showEmptyMessage) {
    return (
      <FileSearchMessage
        iconName={hasQuery ? "FileQuestion" : "File"}
        message={
          hasQuery ? "No files match your search." : "Type to search files."
        }
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-1">
      {/* The loading/error message stands in for the Files group while no file
          rows exist, so it leads the results just as that group would. */}
      {showFileSearchMessage ? (
        <FileSearchMessage
          iconName={
            showError ? "AlertCircle" : showLoading ? "Spinner" : "FileQuestion"
          }
          iconClassName={showLoading ? "animate-spin" : undefined}
          message={
            showError
              ? "File search failed."
              : showLoading
                ? "Searching files..."
                : "No files match your search."
          }
        />
      ) : null}

      {showListbox ? (
        <div id={listboxId} role="listbox" aria-label="File search results">
          {showFilesSection && filesSection ? (
            <section role="group" aria-label={FILE_SEARCH_SECTION_LABELS.files}>
              <LauncherSectionHeader
                label={FILE_SEARCH_SECTION_LABELS.files}
                sticky
              />
              <div className="flex flex-col gap-px">
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
          ) : null}

          {recentSection ? (
            <section
              role="group"
              aria-label={FILE_SEARCH_SECTION_LABELS.recent}
              className={cn(hasRecentSectionPredecessor && "mt-3")}
            >
              <LauncherSectionHeader
                label={FILE_SEARCH_SECTION_LABELS.recent}
                count={recent.count > 0 ? recent.count : undefined}
                sticky
                className={hasRecentSectionPredecessor ? "pt-2" : undefined}
              />
              <div className="flex flex-col gap-px">
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
            </section>
          ) : null}
        </div>
      ) : null}

      {recent.emptyHintVisible && recentSection === undefined ? (
        // Empty Recent zero-state. It is a framed dashed placeholder card, not a
        // selectable option, so it sits outside the listbox. This belongs to the
        // Open file / search surface only; the browser new-tab and root + menu
        // stay card-less.
        <section className={cn(hasRecentSectionPredecessor && "mt-3")}>
          <LauncherSectionHeader
            label={FILE_SEARCH_SECTION_LABELS.recent}
            sticky
            className={hasRecentSectionPredecessor ? "pt-2" : undefined}
          />
          <EmptyStatePanel className={cn("py-4", COARSE_POINTER_TEXT_SM_CLASS)}>
            Plans, mockups, and files you open will show up here.
          </EmptyStatePanel>
        </section>
      ) : null}

      {recent.toggleVisible ? (
        <button
          type="button"
          aria-expanded={recent.isExpanded}
          onClick={recent.onToggleExpanded}
          className={cn(
            "ml-1.5 mt-0.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        >
          <Icon
            name="ChevronDown"
            className={cn(
              COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
              "transition-transform",
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
    </div>
  );
}
