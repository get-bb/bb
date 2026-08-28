import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type UIEvent,
} from "react";
import {
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
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { Icon } from "@bb/shared-ui/icon";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  ComposerCommandSuggestion,
  PromptMentionSuggestion,
  TypeaheadMenuState,
} from "@bb/client-core";

export type TypeaheadSuggestion =
  | PromptMentionSuggestion
  | ComposerCommandSuggestion;

interface MentionMenuProps {
  state: TypeaheadMenuState;
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  onDismiss?: () => void;
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

function groupSections<TKind extends string, TItem>(args: {
  suggestions: readonly TItem[];
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

  return [...sectionsByKind.values()];
}

type PathMentionSectionKind = "workspace" | "thread-storage";
type PluginMentionSectionKind = `plugin:${string}`;
type MentionSectionKind =
  | "threads"
  | "projects"
  | "sections"
  | PathMentionSectionKind
  | PluginMentionSectionKind;
type PathMentionSuggestion = Extract<PromptMentionSuggestion, { kind: "path" }>;
type SecondaryContextKind = "path" | "project";

function getPluginSectionKind(
  item: Extract<PromptMentionSuggestion, { kind: "plugin" }>,
): PluginMentionSectionKind {
  return `plugin:${item.pluginId}:${item.providerId}`;
}

function getPluginSectionLabels(
  suggestions: readonly PromptMentionSuggestion[],
): Map<PluginMentionSectionKind, string> {
  const labels = new Map<PluginMentionSectionKind, string>();
  for (const item of suggestions) {
    if (item.kind !== "plugin") continue;
    const kind = getPluginSectionKind(item);
    if (!labels.has(kind)) {
      labels.set(kind, item.providerLabel);
    }
  }
  return labels;
}

function getMentionSectionKind(
  item: PromptMentionSuggestion,
): MentionSectionKind {
  if (item.kind === "thread") {
    return "threads";
  }
  if (item.kind === "project") {
    return "projects";
  }
  if (item.kind === "section") {
    return "sections";
  }
  if (item.kind === "plugin") {
    return getPluginSectionKind(item);
  }
  return getPathSectionKind(item);
}

function getPathSectionKind(
  item: PathMentionSuggestion,
): PathMentionSectionKind {
  return item.source === "thread-storage" ? "thread-storage" : "workspace";
}

function getMentionSectionLabel(
  kind: MentionSectionKind,
  pluginSectionLabels: ReadonlyMap<PluginMentionSectionKind, string>,
): string {
  if (kind === "threads") {
    return "Threads";
  }
  if (kind === "projects") {
    return "Projects";
  }
  if (kind === "sections") {
    return "Sections";
  }
  if (kind === "workspace" || kind === "thread-storage") {
    return getPathSectionLabel(kind);
  }
  return pluginSectionLabels.get(kind) ?? kind.slice("plugin:".length);
}

function getPathSectionLabel(kind: PathMentionSectionKind): string {
  if (kind === "thread-storage") {
    return "Thread storage";
  }
  return "Workspace";
}

function getMentionTitle(item: PromptMentionSuggestion): string {
  if (item.kind === "thread") {
    const title = item.title || item.path;
    return item.projectName ? `${title} · ${item.projectName}` : title;
  }

  if (item.kind === "project") {
    return `Project: ${item.name}`;
  }

  if (item.kind === "section") {
    return `Section: ${item.name}`;
  }

  if (item.kind === "plugin") {
    return `${item.providerLabel}: ${item.title}`;
  }

  return `${getPathSectionLabel(getPathSectionKind(item))}: ${item.path}`;
}

function getMentionKey(item: PromptMentionSuggestion, index: number): string {
  if (item.kind === "path") {
    return `${item.kind}-${item.source}-${item.entryKind}-${item.path}-${index}`;
  }
  if (item.kind === "plugin") {
    return `${item.kind}-${item.pluginId}-${item.itemId}-${index}`;
  }
  return `${item.kind}-${item.path}-${index}`;
}

type CommandSectionKind = ProviderCommandSection;

function getCommandSectionKind(
  item: ComposerCommandSuggestion,
): CommandSectionKind {
  return providerCommandSection(item);
}

function getCommandSectionLabel(kind: CommandSectionKind): string {
  if (kind === "agent-command") {
    return "Commands";
  }
  if (kind === "skill") {
    return "Skills";
  }
  return kind === "project-command" ? "Project commands" : "User commands";
}

const ROW_ICON_CLASS = "size-3.5 shrink-0 text-muted-foreground";

function getCommandIcon(item: ComposerCommandSuggestion): ReactNode {
  if (item.pluginId !== undefined) {
    return (
      <PluginIcon
        pluginId={item.pluginId}
        icon={null}
        className={ROW_ICON_CLASS}
      />
    );
  }
  return (
    <Icon
      name={promptCommandIconName(item)}
      className={ROW_ICON_CLASS}
      aria-hidden
    />
  );
}

function getMentionIcon(item: PromptMentionSuggestion): ReactNode {
  if (item.kind === "plugin") {
    return (
      <PluginIcon
        pluginId={item.pluginId}
        icon={item.icon}
        className={ROW_ICON_CLASS}
      />
    );
  }
  return (
    <Icon
      name={promptMentionIconName(promptMentionResourceFromSuggestion(item))}
      className={ROW_ICON_CLASS}
      aria-hidden
    />
  );
}

function getCommandKey(item: ComposerCommandSuggestion, index: number): string {
  return `command-${item.source}-${item.origin}-${item.name}-${index}`;
}

function MutedTrailing({ children }: { children: string }) {
  return (
    <span className="truncate text-subtle-foreground [flex-shrink:9999]">
      {children}
    </span>
  );
}

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
  icon: ReactNode;
  primary: string;
  trailing: ReactNode;
  title: string;
  rowKey: string;
  onApply: () => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}

function SuggestionRow({
  index,
  selectedIndex,
  icon,
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
      className={cn(
        "w-full scroll-mt-7 rounded px-2 py-1.5 text-left text-xs",
        isSelected ? "bg-state-active text-foreground" : "hover:bg-state-hover",
      )}
      title={title}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {icon}
        <span className="truncate text-foreground">{primary}</span>
        {trailing}
      </div>
    </button>
  );
}

function CloseSuggestionsButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close suggestions"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onDismiss}
      className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
    >
      <Icon name="X" className="size-4" aria-hidden />
    </button>
  );
}

function MenuStatusRow({
  children,
  onDismiss,
  className,
}: {
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-xs",
        onDismiss
          ? "flex h-11 items-center justify-between pl-3 pr-1"
          : "px-3 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      {onDismiss ? <CloseSuggestionsButton onDismiss={onDismiss} /> : null}
    </div>
  );
}

function MenuSectionHeader({
  label,
  onDismiss,
}: {
  label: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 bg-background text-xs text-muted-foreground",
        onDismiss
          ? "flex h-11 items-center justify-between pl-3 pr-1"
          : "px-3 pb-1 pt-1.5",
      )}
    >
      <span>{label}</span>
      {onDismiss ? <CloseSuggestionsButton onDismiss={onDismiss} /> : null}
    </div>
  );
}

function MentionResults({
  suggestions,
  selectedIndex,
  onApply,
  onDismiss,
  itemRefs,
}: {
  suggestions: readonly PromptMentionSuggestion[];
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  onDismiss?: () => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}) {
  const sections = useMemo(() => {
    const pluginSectionLabels = getPluginSectionLabels(suggestions);
    return groupSections({
      suggestions,
      sectionKind: getMentionSectionKind,
      sectionLabel: (kind) => getMentionSectionLabel(kind, pluginSectionLabels),
    });
  }, [suggestions]);

  if (sections.length === 0) {
    return (
      <MenuStatusRow onDismiss={onDismiss} className="text-muted-foreground">
        No matching mentions
      </MenuStatusRow>
    );
  }

  return (
    <div className="pb-1">
      {sections.map((section, sectionIndex) => (
        <div key={section.kind}>
          <MenuSectionHeader
            label={section.label}
            onDismiss={sectionIndex === 0 ? onDismiss : undefined}
          />
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
              } else if (item.kind === "section") {
                primary = item.name;
              } else if (item.kind === "plugin") {
                primary = item.title;
                secondaryContext = item.subtitle;
                secondaryContextKind =
                  item.subtitle === null ? null : "project";
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
                  icon={getMentionIcon(item)}
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
  onDismiss,
  itemRefs,
}: {
  suggestions: readonly ComposerCommandSuggestion[];
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  onDismiss?: () => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}) {
  const sections = useMemo(
    () =>
      groupSections({
        suggestions,
        sectionKind: getCommandSectionKind,
        sectionLabel: getCommandSectionLabel,
      }),
    [suggestions],
  );

  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="pb-1">
      {sections.map((section, sectionIndex) => (
        <div key={section.kind}>
          <MenuSectionHeader
            label={section.label}
            onDismiss={sectionIndex === 0 ? onDismiss : undefined}
          />
          <div className="flex flex-col gap-px px-1">
            {section.items.map(({ item, index }) => (
              <SuggestionRow
                key={getCommandKey(item, index)}
                index={index}
                selectedIndex={selectedIndex}
                icon={getCommandIcon(item)}
                primary={item.name}
                trailing={
                  <>
                    {item.description !== null ? (
                      <MutedTrailing>{item.description}</MutedTrailing>
                    ) : null}
                    {item.kind === "command" && item.argumentHint !== null ? (
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
  onDismiss,
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

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, resultsLength);
  }, [resultsLength]);

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
          <MenuStatusRow
            onDismiss={onDismiss}
            className="text-muted-foreground"
          >
            Type to search mentions
          </MenuStatusRow>
        ) : innerState.kind === "loading" ? (
          <MenuStatusRow
            onDismiss={onDismiss}
            className="text-muted-foreground"
          >
            <Icon name="Spinner" className="size-3.5 animate-spin" />
            <span>
              {state.trigger === "command"
                ? "Searching commands…"
                : "Searching mentions…"}
            </span>
          </MenuStatusRow>
        ) : innerState.kind === "error" ? (
          <MenuStatusRow onDismiss={onDismiss} className="text-destructive">
            {state.trigger === "command"
              ? "Failed to load commands"
              : "Failed to load suggestions"}
          </MenuStatusRow>
        ) : state.trigger === "command" ? (
          <CommandResults
            suggestions={
              state.state.kind === "results" ? state.state.suggestions : []
            }
            selectedIndex={selectedIndex}
            onApply={onApply}
            itemRefs={itemRefs}
            onDismiss={onDismiss}
          />
        ) : (
          <MentionResults
            suggestions={
              state.state.kind === "results" ? state.state.suggestions : []
            }
            selectedIndex={selectedIndex}
            onApply={onApply}
            itemRefs={itemRefs}
            onDismiss={onDismiss}
          />
        )}
      </div>
    </div>
  );
}
