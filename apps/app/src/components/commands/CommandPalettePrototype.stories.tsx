import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { TabPill } from "@/components/ui/tab-pill";

export default {
  title: "commands/Command palette prototype",
};

type Mode = "commands" | "threads";
type ThreadScope = "all" | "active" | "draft" | "archived";
type ThreadState = Exclude<ThreadScope, "all">;

interface CommandRow {
  bucket: "Threads" | "Actions" | "Plugins";
  group: string;
  label: string;
  shortcut?: string;
  drillIn?: boolean;
}

interface ThreadRow {
  id: string;
  title: string;
  metadata: string;
  state: ThreadState;
}

const COMMANDS = [
  {
    bucket: "Threads",
    group: "Threads",
    label: "New thread",
    shortcut: "⇧ ⌘ O",
  },
  {
    bucket: "Threads",
    group: "Threads",
    label: "Search threads…",
    shortcut: "⌘ K",
    drillIn: true,
  },
  {
    bucket: "Threads",
    group: "Threads",
    label: "Rename thread",
  },
  {
    bucket: "Threads",
    group: "Threads",
    label: "Archive thread",
  },
  {
    bucket: "Threads",
    group: "Threads",
    label: "Previous thread",
    shortcut: "⇧ ⌘ [",
  },
  {
    bucket: "Threads",
    group: "Threads",
    label: "Next thread",
    shortcut: "⇧ ⌘ ]",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "New window",
    shortcut: "⇧ ⌘ N",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Open settings",
    shortcut: "⌘ ,",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Open server settings",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Toggle sidebar",
    shortcut: "⌘ \\",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "New panel tab",
    shortcut: "⌘ T",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Close panel tab",
    shortcut: "⌘ W",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Toggle panel",
    shortcut: "⌘ J",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Focus previous chat pane",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Focus next chat pane",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Toggle focused chat pane size",
    shortcut: "⇧ ⌘ E",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Close focused chat pane",
    shortcut: "⇧ ⌘ X",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Open server and daemon logs",
  },
  {
    bucket: "Actions",
    group: "Workspace",
    label: "Quick open file",
    shortcut: "⌘ P",
  },
  {
    bucket: "Actions",
    group: "Workspace",
    label: "Toggle diff",
    shortcut: "⌘ D",
  },
  {
    bucket: "Actions",
    group: "Workspace",
    label: "Open terminal",
    shortcut: "⇧ ⌘ ↵",
  },
  {
    bucket: "Actions",
    group: "Workspace",
    label: "Open in preferred app",
    shortcut: "⌘ O",
  },
  {
    bucket: "Actions",
    group: "Composer and models",
    label: "Focus composer",
    shortcut: "⇧ ⌘ C",
  },
  {
    bucket: "Actions",
    group: "Composer and models",
    label: "Toggle model picker",
    shortcut: "⇧ ⌘ M",
  },
  {
    bucket: "Actions",
    group: "Browser",
    label: "Focus location",
    shortcut: "⌘ L",
  },
  {
    bucket: "Actions",
    group: "Browser",
    label: "Reload page",
    shortcut: "⌘ R",
  },
  {
    bucket: "Actions",
    group: "Browser",
    label: "Find in page",
    shortcut: "⌘ F",
  },
  {
    bucket: "Actions",
    group: "Window and layout",
    label: "Split",
  },
  {
    bucket: "Plugins",
    group: "Design Doctrine",
    label: "Open Design Doctrine",
  },
  {
    bucket: "Plugins",
    group: "GitHub Activity",
    label: "Open GitHub Activity",
  },
] as const satisfies readonly CommandRow[];

const THREADS = [
  {
    id: "palette-redesign",
    title: "Redesign the command palette",
    metadata: "bb · just now",
    state: "active",
  },
  {
    id: "sidebar-evidence",
    title: "Replace sidebar stack screenshot evidence",
    metadata: "bb · 12m ago",
    state: "active",
  },
  {
    id: "filter-states",
    title: "Review thread filter states",
    metadata: "bb · Yesterday",
    state: "draft",
  },
  {
    id: "mobile-drawer",
    title: "Investigate mobile drawer performance",
    metadata: "Mobile · Yesterday",
    state: "active",
  },
  {
    id: "project-grouping",
    title: "Confirm project grouping hierarchy",
    metadata: "Sidebar polish · 3d ago",
    state: "active",
  },
  {
    id: "legacy-navigation",
    title: "Legacy navigation audit",
    metadata: "1w ago",
    state: "archived",
  },
] as const satisfies readonly ThreadRow[];

const THREAD_STATE: Record<ThreadState, { label: string }> = {
  active: { label: "Active" },
  draft: { label: "Draft" },
  archived: { label: "Archived" },
};

const SCOPES = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "draft", label: "Drafts" },
  { id: "archived", label: "Archived" },
] as const satisfies readonly { id: ThreadScope; label: string }[];

function Shortcut({ children }: { children: string }) {
  return (
    <kbd className="inline-flex shrink-0 items-center rounded-sm bg-state-hover px-1.5 py-1 font-sans text-xs font-normal leading-none tabular-nums text-subtle-foreground opacity-70">
      {children}
    </kbd>
  );
}

function PaletteFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[720px] items-start justify-center bg-surface-recessed-soft-solid px-5 py-20 text-foreground">
      <div className="w-full max-w-[640px] overflow-hidden rounded-xl border border-border bg-background shadow-lg">
        {children}
      </div>
    </div>
  );
}

function CommandPalettePrototype() {
  const [mode, setMode] = useState<Mode>("commands");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scope, setScope] = useState<ThreadScope>("all");
  const [scopeOpen, setScopeOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const scrollOnNextSelectionRef = useRef(false);
  const overflow = useScrollOverflowState<HTMLDivElement>({
    measureOverflow: true,
  });
  const composedResultsRef = useComposedRefs(resultsRef, overflow.scrollRef);
  const resultsMask =
    overflow.aboveOverflow && overflow.belowOverflow
      ? "linear-gradient(to bottom, transparent 0, black 1.5rem, black calc(100% - 1.5rem), transparent 100%)"
      : overflow.aboveOverflow
        ? "linear-gradient(to bottom, transparent 0, black 1.5rem, black 100%)"
        : overflow.belowOverflow
          ? "linear-gradient(to bottom, black 0, black calc(100% - 1.5rem), transparent 100%)"
          : undefined;

  const commandRows = useMemo<readonly CommandRow[]>(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length === 0) return COMMANDS;
    return COMMANDS.filter((command) =>
      [command.label, command.group, command.bucket]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query]);

  const threadRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return THREADS.filter(
      (thread) =>
        (scope === "all" || thread.state === scope) &&
        (normalized.length === 0 ||
          `${thread.title} ${thread.metadata}`
            .toLocaleLowerCase()
            .includes(normalized)),
    );
  }, [query, scope]);

  const visibleCount =
    mode === "commands" ? commandRows.length : threadRows.length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [mode, query, scope]);

  useEffect(() => {
    if (!scrollOnNextSelectionRef.current) return;
    scrollOnNextSelectionRef.current = false;
    resultsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const enterThreads = () => {
    setMode("threads");
    setQuery("");
    setScope("all");
    setScopeOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const exitThreads = () => {
    setMode("commands");
    setQuery("");
    setScopeOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const activateSelected = () => {
    if (mode !== "commands") return;
    if (commandRows[selectedIndex]?.drillIn) enterThreads();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && mode === "threads" && query.length === 0) {
      event.preventDefault();
      exitThreads();
      return;
    }
    if (event.key === "Escape") {
      if (mode === "threads") {
        event.preventDefault();
        exitThreads();
      }
      return;
    }
    if (visibleCount === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      scrollOnNextSelectionRef.current = true;
      setSelectedIndex((current) => {
        if (event.key === "ArrowDown") {
          return current + 1 >= visibleCount ? 0 : current + 1;
        }
        return current === 0 ? visibleCount - 1 : current - 1;
      });
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      scrollOnNextSelectionRef.current = true;
      setSelectedIndex(event.key === "Home" ? 0 : visibleCount - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activateSelected();
    }
  };

  return (
    <PaletteFrame>
      <div className="border-b border-border bg-background px-3 py-2">
        <div className="flex h-10 items-center gap-2 px-3">
          {mode === "threads" ? (
            <ModeChip onClear={exitThreads} />
          ) : null}
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-prototype-results"
            aria-activedescendant={
              visibleCount === 0
                ? undefined
                : `command-palette-prototype-option-${selectedIndex}`
            }
            aria-label={
              mode === "commands" ? "Search commands" : "Search threads"
            }
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground placeholder:font-light placeholder:opacity-70"
            placeholder={
              mode === "commands"
                ? "Search commands…"
                : "Search title, project, or message…"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {mode === "threads" ? (
            <ScopePicker
              open={scopeOpen}
              scope={scope}
              onOpenChange={setScopeOpen}
              onScopeChange={(nextScope) => {
                setScope(nextScope);
                setScopeOpen(false);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 overflow-hidden bg-background">
        <div
          ref={composedResultsRef}
          id="command-palette-prototype-results"
          role="listbox"
          aria-label={mode === "commands" ? "Commands" : "Threads"}
          className="max-h-[min(24rem,50dvh)] overflow-y-auto p-2"
          style={{
            WebkitMaskImage: resultsMask,
            maskImage: resultsMask,
          }}
        >
          <div
            ref={overflow.topSentinelRef}
            aria-hidden
            className="-mb-px h-px w-full"
          />
          {mode === "commands" ? (
            <CommandResults
              rows={commandRows}
              grouped={query.trim().length === 0}
              selectedIndex={selectedIndex}
              onActivate={setSelectedIndex}
              onEnterThreads={enterThreads}
            />
          ) : (
            <ThreadResults
              rows={threadRows}
              selectedIndex={selectedIndex}
              onActivate={setSelectedIndex}
            />
          )}
          <div
            ref={overflow.bottomSentinelRef}
            aria-hidden
            className="h-px w-full"
          />
        </div>
      </div>

      <PaletteFooter mode={mode} />
    </PaletteFrame>
  );
}

function ModeChip({ onClear }: { onClear: () => void }) {
  return (
    <TabPill
      ariaLabel="Threads search"
      label="Threads"
      title="Threads"
      isActive
      onSelect={() => undefined}
      leadingVisual={<Icon name="Search" aria-hidden />}
      closeAction={{
        onClose: onClear,
        closeLabel: "Return to commands",
      }}
    />
  );
}

function ScopePicker({
  onOpenChange,
  onScopeChange,
  open,
  scope,
}: {
  onOpenChange: (open: boolean) => void;
  onScopeChange: (scope: ThreadScope) => void;
  open: boolean;
  scope: ThreadScope;
}) {
  const current = SCOPES.find((candidate) => candidate.id === scope);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-subtle-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpenChange(!open)}
      >
        <span>{current?.label ?? "All"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Thread scope"
          className="absolute right-0 top-full z-10 mt-1 min-w-32 rounded-lg border border-border bg-popover p-1.5 shadow-md"
        >
          {SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === scope}
              className={cn(
                "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-state-hover focus-visible:bg-state-hover",
                option.id === scope && "bg-state-hover",
              )}
              onClick={() => onScopeChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CommandResults({
  grouped,
  onActivate,
  onEnterThreads,
  rows,
  selectedIndex,
}: {
  grouped: boolean;
  onActivate: (index: number) => void;
  onEnterThreads: () => void;
  rows: readonly CommandRow[];
  selectedIndex: number;
}) {
  if (rows.length === 0) return <EmptyMessage>No matching commands</EmptyMessage>;

  if (!grouped) {
    return rows.map((row, index) => (
      <CommandOption
        key={row.label}
        id={`command-palette-prototype-option-${index}`}
        row={row}
        selected={selectedIndex === index}
        onActivate={() => onActivate(index)}
        onSelect={row.drillIn ? onEnterThreads : undefined}
      />
    ));
  }

  let visibleIndex = 0;
  return (["Threads", "Actions", "Plugins"] as const).map((bucket) => {
    const bucketRows = rows.filter((row) => row.bucket === bucket);
    if (bucketRows.length === 0) return null;
    const startIndex = visibleIndex;
    visibleIndex += bucketRows.length;
    return (
      <div key={bucket} role="group" aria-label={bucket}>
        <div className={cn(CHROME_SECTION_LABEL_CLASS, "px-3 pb-1 pt-3")}>
          {bucket}
        </div>
        {bucketRows.map((row, index) => {
          const indexInList = startIndex + index;
          return (
            <CommandOption
              key={row.label}
              id={`command-palette-prototype-option-${indexInList}`}
              row={row}
              selected={selectedIndex === indexInList}
              onActivate={() => onActivate(indexInList)}
              onSelect={row.drillIn ? onEnterThreads : undefined}
            />
          );
        })}
      </div>
    );
  });
}

function CommandOption({
  id,
  onActivate,
  onSelect,
  row,
  selected,
}: {
  id: string;
  onActivate: () => void;
  onSelect?: () => void;
  row: CommandRow;
  selected: boolean;
}) {
  const metadata = row.group === row.bucket ? null : row.group;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      className={cn(
        "flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm outline-none",
        selected && "bg-state-hover text-foreground",
      )}
      onPointerMove={onActivate}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {metadata === null ? null : (
          <span className="text-xs text-muted-foreground">{metadata}</span>
        )}
        {row.shortcut === undefined ? null : (
          <Shortcut>{row.shortcut}</Shortcut>
        )}
      </span>
      {row.drillIn ? (
        <span className="sr-only">Opens a search view</span>
      ) : null}
    </div>
  );
}

function ThreadResults({
  onActivate,
  rows,
  selectedIndex,
}: {
  onActivate: (index: number) => void;
  rows: readonly ThreadRow[];
  selectedIndex: number;
}) {
  if (rows.length === 0) return <EmptyMessage>No matching threads</EmptyMessage>;
  return rows.map((row, index) => {
    const presentation = THREAD_STATE[row.state];
    return (
      <div
        key={row.id}
        id={`command-palette-prototype-option-${index}`}
        role="option"
        aria-selected={selectedIndex === index}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 text-sm",
          selectedIndex === index && "bg-state-hover text-foreground",
        )}
        onPointerMove={() => onActivate(index)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{row.title}</span>
          <span className="block truncate text-xs leading-4 text-subtle-foreground">
            {row.metadata}
          </span>
        </span>
        {row.state === "active" ? null : (
          <span className="shrink-0 text-xs text-subtle-foreground">
            {presentation.label}
          </span>
        )}
      </div>
    );
  });
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function PaletteFooter({ mode }: { mode: Mode }) {
  const hints =
    mode === "threads"
      ? ([
          { keys: ["↑↓"], label: "Select" },
          { keys: ["↵"], label: "Open" },
          { keys: ["⌘↵"], label: "Split" },
          { keys: ["Backspace", "Esc"], label: "Back" },
        ] as const)
      : ([
          { keys: ["↑↓"], label: "Select" },
          { keys: ["↵"], label: "Run" },
        ] as const);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface-recessed-soft-solid px-4 py-2 text-xs text-subtle-foreground">
      {hints.map((hint) => (
        <span key={hint.label} className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1">
            {hint.keys.map((keys, index) => (
              <span key={keys} className="inline-flex items-center gap-1">
                {index === 0 ? null : (
                  <span aria-hidden="true" className="text-muted-foreground/60">
                    /
                  </span>
                )}
                <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground shadow-xs">
                  {keys}
                </kbd>
              </span>
            ))}
          </span>
          <span className="opacity-70">{hint.label}</span>
        </span>
      ))}
    </div>
  );
}

export function Review() {
  return <CommandPalettePrototype />;
}
