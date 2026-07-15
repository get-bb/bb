import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ThreadListEntry } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Pill } from "@bb/shared-ui/pill";
import { ThreadUnarchiveButton } from "@/components/thread/ThreadUnarchiveButton";
import { useUnarchiveThread } from "@/hooks/mutations/thread-state-mutations";
import {
  hasThreadSearchableQuery,
  useArchivedThreads,
  useThreadSearch,
  type UseArchivedThreadsFilters,
} from "@/hooks/queries/thread-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import type { ArchivedThreadsKindFilter } from "@/hooks/queries/query-keys";
import { getThreadRoutePath } from "@/lib/route-paths";
import { formatRelativeTime } from "@/lib/relative-time";
import { getThreadDisplayTitle } from "@/lib/thread-title";

const ALL_PROJECTS = "all";
const ARCHIVED_THREAD_SEARCH_LIMIT = 50;

const KIND_OPTIONS: ReadonlyArray<{
  label: string;
  value: ArchivedThreadsKindFilter;
}> = [
  { label: "All threads", value: "all" },
  { label: "Root threads", value: "root" },
  { label: "Child threads", value: "child" },
];

interface ArchiveFilterMenuProps<T extends string> {
  icon: IconName;
  label: string;
  options: ReadonlyArray<{ label: string; value: T }>;
  onChange: (value: T) => void;
  value: T;
}

function ArchiveFilterMenu<T extends string>({
  icon,
  label,
  onChange,
  options,
  value,
}: ArchiveFilterMenuProps<T>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-8 min-w-36 justify-between gap-2 px-3 text-xs font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon name={icon} className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.value === value ? (
              <Icon name="Check" className="size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function filterArchivedThreadsBySearch(
  threads: ThreadListEntry[],
  search: string,
): ThreadListEntry[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  if (normalizedSearch.length === 0) return threads;
  return threads.filter((thread) =>
    getThreadDisplayTitle(thread)
      .toLocaleLowerCase()
      .includes(normalizedSearch),
  );
}

export function ArchivedThreadsSettingsSection() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ArchivedThreadsKindFilter>("all");
  const [projectId, setProjectId] = useState(ALL_PROJECTS);
  const sidebarNavigation = useSidebarNavigation();
  const searchIsActive = hasThreadSearchableQuery(search);
  const archivedThreadsQuery = useArchivedThreads(
    {
      ...(projectId === ALL_PROJECTS ? {} : { projectId }),
      kind,
    } satisfies UseArchivedThreadsFilters,
    { enabled: !searchIsActive },
  );
  const threadSearch = useThreadSearch({
    active: searchIsActive,
    limitPerGroup: ARCHIVED_THREAD_SEARCH_LIMIT,
    query: search,
  });
  const unarchiveThread = useUnarchiveThread();

  const projects = useMemo(() => {
    if (!sidebarNavigation.data) return [];
    return [
      sidebarNavigation.data.personalProject,
      ...sidebarNavigation.data.projects,
    ];
  }, [sidebarNavigation.data]);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const projectOptions = useMemo(
    () => [
      { label: "All projects", value: ALL_PROJECTS },
      ...projects.map((project) => ({
        label: project.name,
        value: project.id,
      })),
    ],
    [projects],
  );

  const archivedThreads = useMemo(() => {
    const threads = searchIsActive
      ? (threadSearch.data?.archived.results.map((result) => result.thread) ??
        [])
      : (archivedThreadsQuery.data?.pages ?? []).flat();
    const filteredThreads = threads.filter(
      (thread) =>
        thread.archivedAt !== null &&
        (projectId === ALL_PROJECTS || thread.projectId === projectId) &&
        (kind === "all" ||
          (thread.parentThreadId !== null) === (kind === "child")),
    );
    return searchIsActive
      ? filteredThreads
      : filterArchivedThreadsBySearch(filteredThreads, search);
  }, [
    archivedThreadsQuery.data,
    kind,
    projectId,
    search,
    searchIsActive,
    threadSearch.data,
  ]);

  const groupedThreads = useMemo(() => {
    const groups = new Map<string, ThreadListEntry[]>();
    for (const thread of archivedThreads) {
      const group = groups.get(thread.projectId);
      if (group) group.push(thread);
      else groups.set(thread.projectId, [thread]);
    }
    return [...groups.entries()];
  }, [archivedThreads]);

  const selectedKindLabel =
    KIND_OPTIONS.find((option) => option.value === kind)?.label ??
    "All threads";
  const selectedProjectLabel =
    projectOptions.find((option) => option.value === projectId)?.label ??
    "All projects";
  const isInitialLoading = searchIsActive
    ? threadSearch.isDebouncing ||
      (threadSearch.isLoading && threadSearch.data === undefined)
    : archivedThreadsQuery.isPending;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Archived threads
        </h2>
        <p className="mt-1 text-xs text-subtle-foreground">
          Find and restore archived threads from across your projects.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground"
          />
          <Input
            aria-label="Search archived threads"
            className="h-8 pl-8 text-xs"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search archived threads…"
            value={search}
          />
        </div>
        <ArchiveFilterMenu
          icon="SlidersHorizontal"
          label={selectedKindLabel}
          onChange={setKind}
          options={KIND_OPTIONS}
          value={kind}
        />
        <ArchiveFilterMenu
          icon="Folder"
          label={selectedProjectLabel}
          onChange={setProjectId}
          options={projectOptions}
          value={projectId}
        />
      </div>

      {isInitialLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading archived threads…
        </p>
      ) : archivedThreads.length === 0 ? (
        <EmptyStatePanel className="py-8">
          {search.trim().length > 0
            ? "No archived threads match your search."
            : "No archived threads match these filters."}
        </EmptyStatePanel>
      ) : (
        <div className="space-y-6">
          {groupedThreads.map(([groupProjectId, threads]) => (
            <section key={groupProjectId} className="space-y-2">
              <div className="flex items-center gap-2 px-0.5 text-xs font-medium text-muted-foreground">
                <Icon name="Folder" className="size-3.5" />
                <h3 className="min-w-0 flex-1 truncate">
                  {projectNames.get(groupProjectId) ?? "Unknown project"}
                </h3>
                <span>
                  {threads.length} {threads.length === 1 ? "thread" : "threads"}
                </span>
              </div>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {threads.map((thread) => (
                  <div
                    key={thread.id}
                    className="flex min-h-14 items-center gap-3 px-4 py-2.5"
                  >
                    <Link
                      className="min-w-0 flex-1"
                      to={getThreadRoutePath({
                        projectId: thread.projectId,
                        threadId: thread.id,
                      })}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="truncate">
                          {getThreadDisplayTitle(thread)}
                        </span>
                        {thread.parentThreadId !== null ? (
                          <Pill variant="outline" className="shrink-0">
                            child
                          </Pill>
                        ) : null}
                      </span>
                      {thread.archivedAt !== null ? (
                        <span className="mt-0.5 block text-xs text-subtle-foreground">
                          Archived{" "}
                          {formatRelativeTime({
                            timestamp: thread.archivedAt,
                            now: Date.now(),
                          })}
                        </span>
                      ) : null}
                    </Link>
                    <ThreadUnarchiveButton
                      variant="secondary"
                      isPending={
                        unarchiveThread.isPending &&
                        unarchiveThread.variables?.id === thread.id
                      }
                      onUnarchive={() =>
                        unarchiveThread.mutate({ id: thread.id })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!searchIsActive && archivedThreadsQuery.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full text-sm font-normal text-muted-foreground"
          disabled={archivedThreadsQuery.isFetchingNextPage}
          onClick={() => archivedThreadsQuery.fetchNextPage()}
        >
          {archivedThreadsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </section>
  );
}
