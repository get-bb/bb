import { useEffect, useMemo, useState } from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/Select";
import { ThreadCard } from "./ThreadCard";
import { SlimRow } from "./SlimRow";
import { useLifecycle } from "./useLifecycle";
import { TRAILING_GLYPH_BOX_CLASS } from "./StatusSlot";
import {
  filterByProject,
  hideChildrenOfVisibleParents,
  partitionPinned,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  visibleInboxThreads,
} from "./inbox";

const ALL_PROJECTS = "__all__";

/**
 * The sidebar's scrolling list: one flat, statically ordered stack of cards.
 *
 * The host owns the New-thread button and the search field above it, so this
 * ships neither. It filters by the `searchQuery` prop and keeps only the one
 * control the host has no equivalent for: the project scope picker.
 */
export function ThreadInbox({
  activeThreadId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const lifecycle = useLifecycle(threads);
  const [scope, setScope] = useState<string>(ALL_PROJECTS);
  // One clock for every card in a render, quantized to the minute so the
  // labels do not disagree and do not churn on unrelated re-renders.
  const [nowMinute, setNowMinute] = useState(() =>
    Math.floor(Date.now() / 60_000),
  );
  useEffect(() => {
    const timer = setInterval(
      () => setNowMinute(Math.floor(Date.now() / 60_000)),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  const now = nowMinute * 60_000;
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const { pinned, inbox, snoozed, settled } = useMemo(() => {
    const scoped = filterByProject(
      visibleInboxThreads(threads),
      scope === ALL_PROJECTS ? null : scope,
    );
    // Children live in their parent's header chip instead of the flat list;
    // an orphan whose parent is not on screen stays here.
    const matched = searchThreadsByTitle(
      hideChildrenOfVisibleParents(scoped),
      searchQuery,
    );
    const active: typeof matched = [];
    const onSnoozeShelf: typeof matched = [];
    const onSettledShelf: typeof matched = [];
    for (const thread of matched) {
      const shelf = lifecycle.shelfFor(thread);
      if (shelf === "snoozed") onSnoozeShelf.push(thread);
      else if (shelf === "settled") onSettledShelf.push(thread);
      else active.push(thread);
    }
    const split = partitionPinned(active);
    return {
      pinned: sortByCreatedAtDescending(split.pinned),
      inbox: sortByCreatedAtDescending(split.inbox),
      // Soonest wake first: "what comes back next" is the shelf's question.
      snoozed: [...onSnoozeShelf].sort(
        (left, right) =>
          (lifecycle.wakeAtFor(left) ?? 0) - (lifecycle.wakeAtFor(right) ?? 0),
      ),
      settled: sortByCreatedAtDescending(onSettledShelf),
    };
  }, [lifecycle, scope, searchQuery, threads]);

  const scopeLabel =
    scope === ALL_PROJECTS
      ? "All projects"
      : (projectNameById.get(scope) ?? "All projects");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The one control the host has no equivalent for. Everything else in
          the chrome above — New thread, search — is bb's and stays bb's. */}
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        <Select value={scope} onValueChange={setScope}>
          {/* Ghost trigger: no border, no filled track — it reads as a label
              until you hover it. */}
          <SelectTrigger
            className="h-7 min-w-0 flex-1 border-0 px-1.5 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-sidebar-accent focus:ring-0"
            aria-label={`Project scope: ${scopeLabel}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS} className="text-xs">
              All projects
            </SelectItem>
            {projects.map((project) => (
              <SelectItem
                key={project.id}
                value={project.id}
                className="text-xs"
              >
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {status === "loading" ? null : status === "error" ? (
          <p
            role="status"
            className="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            Could not load threads.
          </p>
        ) : pinned.length + inbox.length + snoozed.length + settled.length ===
          0 ? (
          <p
            role="status"
            className="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            {searchQuery.trim() ? "No threads found" : "No threads yet"}
          </p>
        ) : (
          <>
            {pinned.length > 0 ? (
              <Shelf label="Pinned">
                {pinned.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    projectName={projectNameById.get(thread.projectId) ?? null}
                    isActive={thread.id === activeThreadId}
                    canPark={lifecycle.canPark(thread)}
                    onNavigate={onNavigate}
                    onSettle={() => lifecycle.settle(thread.id)}
                    onSnooze={(until) => lifecycle.snooze(thread.id, until)}
                    now={now}
                  />
                ))}
              </Shelf>
            ) : null}
            {inbox.length > 0 ? (
              <Shelf label={pinned.length > 0 ? "Inbox" : null}>
                {inbox.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    projectName={projectNameById.get(thread.projectId) ?? null}
                    isActive={thread.id === activeThreadId}
                    canPark={lifecycle.canPark(thread)}
                    onNavigate={onNavigate}
                    onSettle={() => lifecycle.settle(thread.id)}
                    onSnooze={(until) => lifecycle.snooze(thread.id, until)}
                    now={now}
                  />
                ))}
              </Shelf>
            ) : null}
            <ParkedShelf
              label="Snoozed"
              threads={snoozed}
              expanded={showSnoozed}
              onToggle={() => setShowSnoozed((open) => !open)}
              shelf="snoozed"
              activeThreadId={activeThreadId}
              lifecycle={lifecycle}
              onNavigate={onNavigate}
            />
            <ParkedShelf
              label="Settled"
              threads={settled}
              expanded={showSettled}
              onToggle={() => setShowSettled((open) => !open)}
              shelf="settled"
              activeThreadId={activeThreadId}
              lifecycle={lifecycle}
              onNavigate={onNavigate}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A collapsed shelf of parked threads. The header stays while anything is
 * parked — the count is the whole footprint when collapsed — and the shelf
 * vanishes entirely at zero.
 */
function ParkedShelf({
  label,
  threads,
  expanded,
  onToggle,
  shelf,
  activeThreadId,
  lifecycle,
  onNavigate,
}: {
  label: string;
  threads: readonly PluginSidebarThread[];
  expanded: boolean;
  onToggle: () => void;
  shelf: "snoozed" | "settled";
  activeThreadId: string | null;
  lifecycle: ReturnType<typeof useLifecycle>;
  onNavigate: () => void;
}) {
  if (threads.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        // Padded like a card, so the chevron ends on the same right edge as
        // every row's status and provider glyph.
        className="mt-3 flex w-full items-center gap-2 px-2.5 pb-1 text-left"
      >
        <span className="text-2xs font-medium text-muted-foreground/70">
          {expanded ? label : `${label} (${threads.length})`}
        </span>
        <span className="h-px flex-1 bg-sidebar-border" />
        <span className={TRAILING_GLYPH_BOX_CLASS}>
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3 text-muted-foreground/70 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {expanded ? (
        <ul className="flex flex-col gap-px">
          {threads.map((thread) => (
            <SlimRow
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              shelf={shelf}
              wakeAt={lifecycle.wakeAtFor(thread)}
              now={now}
              onNavigate={onNavigate}
              onRestore={() =>
                shelf === "snoozed"
                  ? lifecycle.unsnooze(thread.id)
                  : lifecycle.unsettle(thread.id)
              }
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Shelf({
  label,
  children,
}: {
  label: string | null;
  children: React.ReactNode;
}) {
  return (
    // A named section is exposed as a landmark region; an unnamed one is not,
    // which is exactly right for the single unlabelled inbox list.
    <section {...(label ? { "aria-label": label } : {})}>
      {label ? (
        <h2 className={cn("flex items-center gap-2 px-2.5 pb-1 pt-3")}>
          <span className="text-2xs font-medium text-muted-foreground/70">
            {label}
          </span>
          <span className="h-px flex-1 bg-sidebar-border" />
        </h2>
      ) : null}
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}
