import { useEffect, useRef, type ReactNode } from "react";
import {
  experimental_PluginIcon as PluginIcon,
  experimental_PromptMentionIcon as PromptMentionIcon,
  experimental_ThreadTitleText as ThreadTitle,
  experimental_useThreadTitleDisplayText as useThreadTitleDisplayText,
  type ExperimentalComposerCommandSuggestion,
  type ExperimentalComposerCommandSuggestionGroup,
  type ExperimentalComposerCommandTrigger,
  type ExperimentalComposerThreadRelation,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Pill } from "@/components/ui/pill";
import { TruncateStart } from "@/components/ui/truncate-start";
import { cn } from "@/lib/utils";
import { commandMentionTarget } from "../editor/composer-mentions";
import {
  typeaheadSuggestionKey,
  type MenuMentionGroup,
  type MenuMentionSuggestion,
  type TypeaheadMenuState,
  type TypeaheadSuggestion,
} from "./typeahead-suggestions";

interface MentionMenuProps {
  state: TypeaheadMenuState;
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  onDismiss?: () => void;
}

interface MentionResultsProps {
  groups: readonly MenuMentionGroup[];
  refreshing: boolean;
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  onDismiss?: () => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}

interface CommandResultsProps {
  groups: readonly ExperimentalComposerCommandSuggestionGroup[];
  refreshing: boolean;
  trigger: ExperimentalComposerCommandTrigger;
  selectedIndex: number;
  onApply: (item: TypeaheadSuggestion) => void;
  onDismiss?: () => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}

type PathMentionSuggestion = Extract<MenuMentionSuggestion, { kind: "path" }>;
type SecondaryContextKind = "path" | "project";

function getPathSectionLabel(item: PathMentionSuggestion): string {
  if (item.mention.source === "thread-storage") {
    return "Thread storage";
  }
  return "Workspace";
}

function directoryFromPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

const THREAD_MENTION_RELATION_LABEL: Record<
  ExperimentalComposerThreadRelation,
  string
> = {
  parent: "parent",
  child: "child thread",
  "same-parent": "same parent",
  "same-environment": "same environment",
};

const THREAD_MENTION_RELATION_COMPACT_LABEL: Record<
  ExperimentalComposerThreadRelation,
  string
> = {
  parent: "parent",
  child: "child thread",
  "same-parent": "same parent",
  "same-environment": "same env",
};

function threadMentionRelationLabel(
  relation: ExperimentalComposerThreadRelation | null,
): string | null {
  return relation === null ? null : THREAD_MENTION_RELATION_LABEL[relation];
}

function ThreadRelationPill({
  relation,
}: {
  relation: ExperimentalComposerThreadRelation;
}) {
  const label = THREAD_MENTION_RELATION_LABEL[relation];
  const compactLabel = THREAD_MENTION_RELATION_COMPACT_LABEL[relation];
  return (
    <Pill variant="secondary" size="sm">
      {label === compactLabel ? (
        label
      ) : (
        <>
          <span className="@max-[26rem]/mention-menu:hidden">{label}</span>
          <span className="hidden @max-[26rem]/mention-menu:inline">
            {compactLabel}
          </span>
        </>
      )}
    </Pill>
  );
}

function getMentionTitle(item: MenuMentionSuggestion): string {
  if (item.kind === "thread") {
    const relationLabel = threadMentionRelationLabel(item.relation);
    return [item.title || item.text, item.projectName, relationLabel]
      .filter((part): part is string => part !== null)
      .join(" · ");
  }

  if (item.kind === "project") {
    return `Project: ${item.mention.label}`;
  }

  if (item.kind === "section") {
    return `Section: ${item.mention.label}`;
  }

  if (item.kind === "plugin") {
    return `${item.providerLabel}: ${item.mention.label}`;
  }

  if (item.kind === "attachment") {
    return `Attachment: ${item.mention.label}`;
  }

  return `${getPathSectionLabel(item)}: ${item.mention.path}`;
}

const ROW_ICON_CLASS = "size-3.5 shrink-0 text-muted-foreground";

function getCommandIcon(
  item: ExperimentalComposerCommandSuggestion,
  trigger: ExperimentalComposerCommandTrigger,
): ReactNode {
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
    <PromptMentionIcon
      mention={commandMentionTarget(item, trigger)}
      className={ROW_ICON_CLASS}
    />
  );
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
  primary: ReactNode;
  trailing: ReactNode;
  badge?: ReactNode;
  title: string;
  onApply: () => void;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}

function SuggestionRow({
  index,
  selectedIndex,
  icon,
  primary,
  trailing,
  badge,
  title,
  onApply,
  itemRefs,
}: SuggestionRowProps) {
  const isSelected = index === selectedIndex;
  return (
    <button
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
        {typeof primary === "string" ? (
          <span className="truncate text-foreground">{primary}</span>
        ) : (
          primary
        )}
        {trailing}
        {badge === undefined ? null : (
          <span className="ml-auto shrink-0">{badge}</span>
        )}
      </div>
    </button>
  );
}

type ThreadMentionSuggestion = Extract<
  MenuMentionSuggestion,
  { kind: "thread" }
>;

function ThreadSuggestionRow({
  item,
  ...rowProps
}: Omit<SuggestionRowProps, "primary" | "title"> & {
  item: ThreadMentionSuggestion;
}) {
  const threadTitle = item.title || "Untitled thread";
  const displayTitle = useThreadTitleDisplayText(threadTitle);
  return (
    <SuggestionRow
      {...rowProps}
      primary={<ThreadTitle title={threadTitle} className="text-foreground" />}
      title={getMentionTitle({ ...item, title: displayTitle })}
    />
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
  refreshing = false,
  onDismiss,
}: {
  label: string;
  refreshing?: boolean;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 bg-background text-xs text-muted-foreground",
        onDismiss
          ? "flex h-11 items-center justify-between pl-3 pr-1"
          : "flex items-center px-3 pb-1 pt-1.5",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span>{label}</span>
        <span
          role="status"
          aria-label={refreshing ? "Updating results" : undefined}
          className={cn("flex", !refreshing && "invisible")}
        >
          <Icon name="Spinner" className="size-3 animate-spin" aria-hidden />
        </span>
      </span>
      {onDismiss ? <CloseSuggestionsButton onDismiss={onDismiss} /> : null}
    </div>
  );
}

function groupStartIndexes(
  groups: readonly { suggestions: readonly unknown[] }[],
): number[] {
  return groups.map((_group, index) =>
    groups
      .slice(0, index)
      .reduce((count, group) => count + group.suggestions.length, 0),
  );
}

function MentionResults({
  groups,
  refreshing,
  selectedIndex,
  onApply,
  onDismiss,
  itemRefs,
}: MentionResultsProps) {
  if (groups.length === 0) {
    return (
      <MenuStatusRow onDismiss={onDismiss} className="text-muted-foreground">
        No matching mentions
      </MenuStatusRow>
    );
  }

  const startIndexes = groupStartIndexes(groups);
  return (
    <div className="pb-1">
      {groups.map((group, groupIndex) => {
        const startIndex = startIndexes[groupIndex]!;
        return (
          <div key={group.key}>
            <MenuSectionHeader
              label={group.label}
              refreshing={groupIndex === 0 && refreshing}
              onDismiss={groupIndex === 0 ? onDismiss : undefined}
            />
            <div className="flex flex-col gap-px px-1">
              {group.suggestions.map((item, itemIndex) => {
                const index = startIndex + itemIndex;
                let primary = item.mention.label;
                let secondaryContext: string | null = null;
                let secondaryContextKind: SecondaryContextKind | null = null;

                if (item.kind === "thread") {
                  primary = item.title || "Untitled thread";
                  secondaryContext = item.projectName;
                  secondaryContextKind =
                    item.projectName === null ? null : "project";
                } else if (item.kind === "plugin") {
                  secondaryContext = item.subtitle;
                  secondaryContextKind =
                    item.subtitle === null ? null : "project";
                } else if (item.kind === "path") {
                  const directory = directoryFromPath(item.mention.path);
                  secondaryContext = directory || null;
                  secondaryContextKind = directory ? "path" : null;
                }

                const rowProps = {
                  index,
                  selectedIndex,
                  icon: (
                    <PromptMentionIcon
                      mention={item.mention}
                      className={ROW_ICON_CLASS}
                    />
                  ),
                  trailing:
                    secondaryContext === null ? null : secondaryContextKind ===
                      "path" ? (
                      <MutedTrailingPath>{secondaryContext}</MutedTrailingPath>
                    ) : (
                      <MutedTrailing>{secondaryContext}</MutedTrailing>
                    ),
                  onApply: () => onApply(item),
                  itemRefs,
                };

                return item.kind === "thread" ? (
                  <ThreadSuggestionRow
                    key={item.key}
                    {...rowProps}
                    item={item}
                    badge={
                      item.relation === null ? undefined : (
                        <ThreadRelationPill relation={item.relation} />
                      )
                    }
                  />
                ) : (
                  <SuggestionRow
                    key={item.key}
                    {...rowProps}
                    primary={primary}
                    title={getMentionTitle(item)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CommandResults({
  groups,
  refreshing,
  trigger,
  selectedIndex,
  onApply,
  onDismiss,
  itemRefs,
}: CommandResultsProps) {
  if (groups.length === 0) {
    return null;
  }

  const startIndexes = groupStartIndexes(groups);
  return (
    <div className="pb-1">
      {groups.map((group, groupIndex) => {
        const startIndex = startIndexes[groupIndex]!;
        return (
          <div key={group.key}>
            <MenuSectionHeader
              label={group.label}
              refreshing={groupIndex === 0 && refreshing}
              onDismiss={groupIndex === 0 ? onDismiss : undefined}
            />
            <div className="flex flex-col gap-px px-1">
              {group.suggestions.map((item, itemIndex) => (
                <SuggestionRow
                  key={typeaheadSuggestionKey(item)}
                  index={startIndex + itemIndex}
                  selectedIndex={selectedIndex}
                  icon={getCommandIcon(item, trigger)}
                  primary={item.name}
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
                  onApply={() => onApply(item)}
                  itemRefs={itemRefs}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function typeaheadResultsLength(state: TypeaheadMenuState): number {
  return state.state.kind === "results"
    ? state.state.groups.reduce(
        (count, group) => count + group.suggestions.length,
        0,
      )
    : 0;
}

export function MentionMenu({
  state,
  selectedIndex,
  onApply,
  onDismiss,
}: MentionMenuProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const innerState = state.state;
  const resultsLength = typeaheadResultsLength(state);

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
    <div className="@container/mention-menu flex max-h-(--promptbox-typeahead-max-height) flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground">
      <div className="max-h-48 min-h-0 overflow-y-auto">
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
          state.state.kind === "results" ? (
            <CommandResults
              groups={state.state.groups}
              refreshing={state.state.refreshing}
              trigger={state.char}
              selectedIndex={selectedIndex}
              onApply={onApply}
              itemRefs={itemRefs}
              onDismiss={onDismiss}
            />
          ) : null
        ) : state.state.kind === "results" ? (
          <MentionResults
            groups={state.state.groups}
            refreshing={state.state.refreshing}
            selectedIndex={selectedIndex}
            onApply={onApply}
            itemRefs={itemRefs}
            onDismiss={onDismiss}
          />
        ) : null}
      </div>
    </div>
  );
}
