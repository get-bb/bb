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
import { Icon } from "@/components/ui/icon.js";
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
import { cn } from "@/lib/utils";
import { isPromptDraftEmpty, type PromptDraftState } from "@/lib/prompt-draft";

export const CREATE_APP_PROMPT_TEMPLATE = `You are creating a new bb app for this thread.

Apps system reference — run \`bb guide app\` for full detail. Layout:
- apps/<id>/manifest.json — { manifestVersion: 1, id, name, icon | logo.svg, entry, contributions: ["thread.app"], capabilities: ["data"?, "message"?] }
- apps/<id>/assets/index.html — self-contained inline HTML/CSS/JS/SVG (no build step needed)
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

interface FileSearchMessageProps {
  iconName: "AlertCircle" | "File" | "FileQuestion" | "Spinner";
  iconClassName?: string;
  message: string;
}

/**
 * A navigable entry in a section. Search results carry a {@link FileSearchSuggestion};
 * the synthetic Create App action carries no data and routes to the prefill flow.
 * Keeping both in one union lets the keyboard handler walk a single index space.
 */
type FileSearchSectionEntry =
  | { kind: "suggestion"; suggestion: FileSearchSuggestion }
  | { kind: "create-app" };

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
type FileSearchSectionKind = "apps" | "files";

interface GetAvailableFileSearchSourcesArgs {
  projectId: string | undefined;
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
}

interface GroupFileSearchSectionsArgs {
  suggestions: readonly FileSearchSuggestion[];
  availableSources: readonly FileSearchSource[];
  includeCreateAppEntry: boolean;
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

const FILE_SEARCH_LIMIT = 20;
const FILE_SEARCH_SECTION_ORDER: readonly FileSearchSectionKind[] = [
  "apps",
  "files",
];

const FILE_SEARCH_SECTION_LABELS = {
  apps: "Apps",
  files: "Files",
} satisfies Record<FileSearchSectionKind, string>;

const FILE_SEARCH_SOURCE_LABELS = {
  app: "App",
  workspace: "Workspace",
  "thread-storage": "Manager Storage",
} satisfies Record<FileSearchSource, string>;

const CREATE_APP_ENTRY_ID = "file-search-result-create-app";

const SECTION_HEADER_CLASS =
  "sticky top-0 z-10 bg-background px-1 pb-2 text-xs font-medium uppercase tracking-wider text-subtle-foreground";
const LAUNCHER_TILE_BASE_CLASS =
  "group flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const LAUNCHER_TILE_ICON_CLASS =
  "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-hairline bg-surface-raised";
const LAUNCHER_TILE_ICON_CLASS_DASHED =
  "flex size-9 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-surface-raised text-muted-foreground group-hover:text-foreground";

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
  return getFileSearchResultId(entry.suggestion);
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
  includeCreateAppEntry,
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

  if (includeCreateAppEntry) {
    // The Create App action sits at the end of the Apps section so arrowing
    // down through the real app rows lands on it last. The section is created
    // even when there are no app rows so it stays reachable in the empty state.
    ensureSection("apps").items.push({
      entry: { kind: "create-app" },
      index: 0,
    });
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

export function NewTabFileSearch({
  projectId,
  environmentId,
  currentThreadId,
  currentThreadType,
  focusRequest,
  initialQuery = "",
  onSelect,
  onCreateAppPromptPrefill,
}: NewTabFileSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const promptDraft = usePromptDraftStorage({
    projectId,
    threadId: currentThreadId.length > 0 ? currentThreadId : null,
  });
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
  const sections = useMemo(
    () =>
      groupFileSearchSections({
        availableSources,
        includeCreateAppEntry: showCreateAppEntry,
        suggestions,
      }),
    [availableSources, showCreateAppEntry, suggestions],
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
        handleSuggestionSelect(activeEntry.suggestion);
      }
    },
    [
      activeEntry,
      handleCreateAppPromptPrefill,
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
          onActivateIndex={setActiveIndex}
          onAppSelect={handleAppSelect}
          onCreateApp={handleCreateAppPromptPrefill}
          onFileSelect={handleFileSelect}
          sections={sections}
        />
      )}
    </div>
  );
}

interface NewTabResultsProps {
  activeIndex: number;
  hasQuery: boolean;
  isError: boolean;
  isLoading: boolean;
  onActivateIndex: (index: number) => void;
  onAppSelect: (suggestion: AppSearchSuggestion) => void;
  onCreateApp: () => void;
  onFileSelect: (suggestion: FilePathSearchSuggestion) => void;
  sections: readonly FileSearchSection[];
}

function NewTabResults({
  activeIndex,
  hasQuery,
  isError,
  isLoading,
  onActivateIndex,
  onAppSelect,
  onCreateApp,
  onFileSelect,
  sections,
}: NewTabResultsProps) {
  const appsSection = sections.find((section) => section.kind === "apps");
  const filesSection = sections.find((section) => section.kind === "files");
  // The Apps section now owns the Create App entry, so its mere presence (real
  // app rows and/or the Create App action) is enough to render the shell.
  const showAppsSection = appsSection !== undefined;
  const showFilesSection = filesSection !== undefined;
  const showLoading = isLoading && !showFilesSection;
  const showError = isError && !showFilesSection && !showLoading;
  const showEmptyMessage =
    !showAppsSection && !showFilesSection && !showLoading && !showError;

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
              const isActive = index === activeIndex;
              const id = getFileSearchEntryId(entry);
              if (entry.kind === "create-app") {
                return (
                  <CreateAppTile
                    key="create-app"
                    id={id}
                    isActive={isActive}
                    onActivate={() => onActivateIndex(index)}
                    onSelect={onCreateApp}
                  />
                );
              }
              if (entry.suggestion.entryKind !== "app") {
                return null;
              }
              const suggestion = entry.suggestion;
              return (
                <AppResultRow
                  key={`app:${suggestion.appId}`}
                  id={id}
                  suggestion={suggestion}
                  isActive={isActive}
                  onActivate={() => onActivateIndex(index)}
                  onSelect={onAppSelect}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {showFilesSection && filesSection ? (
        <section className={cn(showAppsSection && "mt-3")}>
          <div className={cn(SECTION_HEADER_CLASS, showAppsSection && "pt-2")}>
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
        <div className={cn(showAppsSection && "mt-3")}>
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
    </div>
  );
}
