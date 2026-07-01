import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type UIEvent,
} from "react";
import {
  PROVIDER_COMMAND_SECTIONS,
  providerCommandSection,
  type ProviderCommandSection,
} from "@bb/server-contract";
import { directoryFromPath } from "@bb/thread-view";
import { promptMentionResourceFromSuggestion } from "@/components/promptbox/editor/prompt-editor-serialization";
import {
  promptCommandIconName,
  promptMentionIconName,
} from "@/components/promptbox/mentions/prompt-mention-display";
import { shouldLoadMoreCommandResults } from "@/components/promptbox/mentions/mention-menu-scroll";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { cn } from "@/lib/utils";
import type {
  ProviderCommandSuggestion,
  PromptMentionSuggestion,
  TypeaheadMenuState,
} from "@/components/promptbox/mentions/types";

/**
 * A row the menu can render — either an `@`-mention suggestion or a command
 * suggestion. The two share a discriminant-free union via their own `kind`
 * field (`path`/`thread` vs `command`), so the composer's apply path can branch
 * by kind without a separate callback per menu mode.
 */
export type TypeaheadSuggestion =
  | PromptMentionSuggestion
  | ProviderCommandSuggestion;

interface MentionMenuProps {
  state: TypeaheadMenuState;
  /** Currently-highlighted index in the results list (for keyboard nav). */
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  onCommandLoadMore?: () => void;
}

interface MenuSectionItem<TItem> {
  item: TItem;
  index: number;
}

interface MenuSection<TKind extends string, TItem> {
  kind: TKind;
  label: string;
  items: MenuSectionItem<TItem>[];
}

/**
 * Groups a flat suggestion list into ordered sections. Shared by the mention
 * and command paths so the section-building/ordering logic lives in one place;
 * each caller supplies how to map a row to its section kind plus the canonical
 * order and labels.
 */
function groupSections<TKind extends string, TItem>(args: {
  suggestions: readonly TItem[];
  order: readonly TKind[];
  sectionKind: (item: TItem) => TKind;
  sectionLabel: (kind: TKind) => string;
}): MenuSection<TKind, TItem>[] {
  const sectionsByKind = new Map<TKind, MenuSection<TKind, TItem>>();
  for (const [index, item] of args.suggestions.entries()) {
    const kind = args.sectionKind(item);
    const existing = sectionsByKind.get(kind);
    if (existing) {
      existing.items.push({ item, index });
      continue;
    }

    sectionsByKind.set(kind, {
      kind,
      label: args.sectionLabel(kind),
      items: [{ item, index }],
    });
  }

  return args.order.flatMap((kind) => {
    const section = sectionsByKind.get(kind);
    return section ? [section] : [];
  });
}

type PathMentionSectionKind = "workspace" | "thread-storage";
type MentionSectionKind = "threads" | "projects" | PathMentionSectionKind;
type PathMentionSuggestion = Extract<PromptMentionSuggestion, { kind: "path" }>;
type SecondaryContextKind = "path" | "project";

const MENTION_SECTION_ORDER: readonly MentionSectionKind[] = [
  "threads",
  "projects",
  "workspace",
  "thread-storage",
];

function getMentionSectionKind(
  item: PromptMentionSuggestion,
): MentionSectionKind {
  if (item.kind === "thread") {
    return "threads";
  }
  if (item.kind === "project") {
    return "projects";
  }
  return getPathSectionKind(item);
}

function getPathSectionKind(
  item: PathMentionSuggestion,
): PathMentionSectionKind {
  return item.source === "thread-storage" ? "thread-storage" : "workspace";
}

function getMentionSectionLabel(kind: MentionSectionKind): string {
  if (kind === "threads") {
    return "Threads";
  }
  if (kind === "projects") {
    return "Projects";
  }
  return getPathSectionLabel(kind);
}

function getPathSectionLabel(kind: PathMentionSectionKind): string {
  if (kind === "thread-storage") {
    return "Thread storage";
  }
  return "Workspace";
}

function getMentionIconName(item: PromptMentionSuggestion): IconName {
  return promptMentionIconName(promptMentionResourceFromSuggestion(item));
}

function getMentionTitle(item: PromptMentionSuggestion): string {
  if (item.kind === "thread") {
    const title = item.title || item.path;
    return item.projectName ? `${title} · ${item.projectName}` : title;
  }

  if (item.kind === "project") {
    return `Project: ${item.name}`;
  }

  return `${getPathSectionLabel(getPathSectionKind(item))}: ${item.path}`;
}

function getMentionKey(item: PromptMentionSuggestion, index: number): string {
  if (item.kind === "path") {
    return `${item.kind}-${item.source}-${item.entryKind}-${item.path}-${index}`;
  }
  return `${item.kind}-${item.path}-${index}`;
}

// Command sections derive from the shared `PROVIDER_COMMAND_SECTIONS` order and
// `providerCommandSection` mapping in @bb/server-contract — the SAME definition
// the server sorts the flat response by — so the menu's visual order and the
// keyboard-nav order can't drift. The menu only adds the human-readable labels.
function getCommandSectionLabel(kind: ProviderCommandSection): string {
  if (kind === "agent-command") {
    return "Commands";
  }
  if (kind === "skill") {
    return "Skills";
  }
  return kind === "project-command" ? "Project commands" : "User commands";
}

function getCommandIconName(item: ProviderCommandSuggestion): IconName {
  return promptCommandIconName(item);
}

function getCommandKey(item: ProviderCommandSuggestion, index: number): string {
  return `command-${item.source}-${item.origin}-${item.name}-${index}`;
}

/** Muted, end-truncated trailing text (project name, command description/hint). */
function MutedTrailing({ children }: { children: string }) {
  return (
    <span className="truncate text-subtle-foreground [flex-shrink:9999]">
      {children}
    </span>
  );
}

/** Muted, start-truncated trailing path (mention directory). */
function MutedTrailingPath({ children }: { children: string }) {
  return (
    <TruncateStart className="text-subtle-foreground [flex-shrink:9999]">
      {children}
    </TruncateStart>
  );
}

interface SuggestionRowProps {
  index: number;
  selectedIndex: number;
  iconName: IconName;
  primary: string;
  /** Muted context rendered after the primary label (mention dir / project, or
   * command description + argument hint). */
  trailing: ReactNode;
  title: string;
  rowKey: string;
  onApply: () => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}

function SuggestionRow({
  index,
  selectedIndex,
  iconName,
  primary,
  trailing,
  title,
  rowKey,
  onApply,
  itemRefs,
}: SuggestionRowProps) {
  const isSelected = index === selectedIndex;
  return (
    <button
      key={rowKey}
      ref={(element) => {
        itemRefs.current[index] = element;
      }}
      type="button"
      onMouseDown={(event) => {
        event.preventDefault();
        onApply();
      }}
      // scroll-mt-7 keeps the row from being scrolled underneath the sticky
      // section header.
      className={cn(
        "w-full scroll-mt-7 rounded px-2 py-1.5 text-left text-xs",
        isSelected ? "bg-state-active text-foreground" : "hover:bg-state-hover",
      )}
      title={title}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon
          name={iconName}
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="truncate text-foreground">{primary}</span>
        {trailing}
      </div>
    </button>
  );
}

function MentionResults({
  suggestions,
  selectedIndex,
  onApply,
  itemRefs,
}: {
  suggestions: readonly PromptMentionSuggestion[];
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}) {
  const sections = useMemo(
    () =>
      groupSections({
        suggestions,
        order: MENTION_SECTION_ORDER,
        sectionKind: getMentionSectionKind,
        sectionLabel: getMentionSectionLabel,
      }),
    [suggestions],
  );

  if (sections.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        No matching mentions
      </div>
    );
  }

  return (
    <div className="pb-1">
      {sections.map((section) => (
        <div key={section.kind}>
          <div className="sticky top-0 z-10 bg-background px-3 pb-1 pt-1.5 text-xs text-muted-foreground">
            {section.label}
          </div>
          <div className="flex flex-col gap-px px-1">
            {section.items.map(({ item, index }) => {
              let primary: string;
              let secondaryContext: string | null = null;
              let secondaryContextKind: SecondaryContextKind | null = null;

              if (item.kind === "thread") {
                primary = item.title || "Untitled thread";
                secondaryContext = item.projectName ?? null;
                secondaryContextKind =
                  item.projectName === undefined ? null : "project";
              } else if (item.kind === "project") {
                primary = item.name;
              } else {
                const directory = directoryFromPath(item.path);
                primary = item.name;
                secondaryContext = directory || null;
                secondaryContextKind = directory ? "path" : null;
              }

              return (
                <SuggestionRow
                  key={getMentionKey(item, index)}
                  index={index}
                  selectedIndex={selectedIndex}
                  iconName={getMentionIconName(item)}
                  primary={primary}
                  trailing={
                    secondaryContext === null ? null : secondaryContextKind ===
                      "path" ? (
                      <MutedTrailingPath>{secondaryContext}</MutedTrailingPath>
                    ) : (
                      <MutedTrailing>{secondaryContext}</MutedTrailing>
                    )
                  }
                  title={getMentionTitle(item)}
                  rowKey={getMentionKey(item, index)}
                  onApply={() => onApply(item)}
                  itemRefs={itemRefs}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function CommandResults({
  suggestions,
  selectedIndex,
  onApply,
  itemRefs,
}: {
  suggestions: readonly ProviderCommandSuggestion[];
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}) {
  const sections = useMemo(
    () =>
      groupSections({
        suggestions,
        order: PROVIDER_COMMAND_SECTIONS,
        sectionKind: providerCommandSection,
        sectionLabel: getCommandSectionLabel,
      }),
    [suggestions],
  );

  // The composer suppresses opening the menu on a loaded-empty result, so an
  // empty command list is only a transient render. Nothing to show.
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="pb-1">
      {sections.map((section) => (
        <div key={section.kind}>
          <div className="sticky top-0 z-10 bg-background px-3 pb-1 pt-1.5 text-xs text-muted-foreground">
            {section.label}
          </div>
          <div className="flex flex-col gap-px px-1">
            {section.items.map(({ item, index }) => (
              <SuggestionRow
                key={getCommandKey(item, index)}
                index={index}
                selectedIndex={selectedIndex}
                iconName={getCommandIconName(item)}
                primary={item.name}
                // description sits inline after the name (muted); argumentHint
                // trails it, further muted, so the name stays the anchor.
                trailing={
                  <>
                    {item.description !== null ? (
                      <MutedTrailing>{item.description}</MutedTrailing>
                    ) : null}
                    {item.argumentHint !== null ? (
                      <span className="shrink-0 text-subtle-foreground">
                        {item.argumentHint}
                      </span>
                    ) : null}
                  </>
                }
                title={item.description ?? item.name}
                rowKey={getCommandKey(item, index)}
                onApply={() => onApply(item)}
                itemRefs={itemRefs}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MentionMenu({
  state,
  selectedIndex,
  onApply,
  onCommandLoadMore,
}: MentionMenuProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (onCommandLoadMore === undefined) {
        return;
      }
      const target = event.currentTarget;
      if (
        shouldLoadMoreCommandResults({
          trigger: state.trigger,
          hasLoadMoreCallback: true,
          scrollHeight: target.scrollHeight,
          scrollTop: target.scrollTop,
          clientHeight: target.clientHeight,
        })
      ) {
        onCommandLoadMore();
      }
    },
    [onCommandLoadMore, state.trigger],
  );

  const innerState = state.state;
  const resultsLength =
    innerState.kind === "results" ? innerState.suggestions.length : 0;

  // Trim refs when the result list shortens so stale entries don't survive.
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, resultsLength);
  }, [resultsLength]);

  // Keep the highlighted row visible as the user arrows through the list.
  useEffect(() => {
    if (resultsLength === 0) return;
    const selectedItem = itemRefs.current[selectedIndex];
    if (!selectedItem) return;
    selectedItem.scrollIntoView({ block: "nearest" });
  }, [resultsLength, selectedIndex]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground">
      <div className="max-h-48 overflow-y-auto" onScroll={handleScroll}>
        {innerState.kind === "hint" ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Type to search mentions
          </div>
        ) : innerState.kind === "loading" ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Icon name="Spinner" className="size-3.5 animate-spin" />
            <span>
              {state.trigger === "command"
                ? "Searching commands…"
                : "Searching mentions…"}
            </span>
          </div>
        ) : innerState.kind === "error" ? (
          <div className="px-3 py-2 text-xs text-destructive">
            {state.trigger === "command"
              ? "Failed to load commands"
              : "Failed to load suggestions"}
          </div>
        ) : state.trigger === "command" ? (
          <CommandResults
            suggestions={
              state.state.kind === "results" ? state.state.suggestions : []
            }
            selectedIndex={selectedIndex}
            onApply={onApply}
            itemRefs={itemRefs}
          />
        ) : (
          <MentionResults
            suggestions={
              state.state.kind === "results" ? state.state.suggestions : []
            }
            selectedIndex={selectedIndex}
            onApply={onApply}
            itemRefs={itemRefs}
          />
        )}
      </div>
    </div>
  );
}
