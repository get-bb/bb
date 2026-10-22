import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import {
  inboxCount,
  parseCollapsed,
  parseQuery,
  pullRowModels,
  pullViewGroups,
  stateNameOf,
  type PullRowModel,
  type Route,
} from "../app-logic.js";
import {
  COLLAPSED_PULL_GROUPS,
  hardMergeBlock,
  pullPreset,
  type PullView,
} from "../pull-status.js";
import { AgentSheet, type AgentTarget } from "./agent-sheet.js";
import { FilterChips, FilterInput } from "./filter-bar.js";
import { IssuesPane } from "./issues.js";
import { useMerge } from "./merge.js";
import {
  copyText,
  currentActivity,
  settleActivity,
  useActivities,
  useChangePullState,
  useSnooze,
} from "./pull-actions.js";
import {
  PullDetailView,
  type DetailRequestKind,
  type PullDetailHandle,
} from "./pull-detail.js";
import {
  HEADER_CLASS,
  INBOX_VIEWS,
  ListMessage,
  ListSkeleton,
  NoMatch,
  PullList,
  ShortcutsDialog,
  ViewTabs,
  type InboxView,
  type PullListActions,
  type PullListContext,
} from "./pull-list.js";
import {
  rowMergeable,
  rowMergeTarget,
  rowState,
  type PullRowPermissions,
  type RowMenuStep,
} from "./row-menu.js";
import {
  isTyping,
  readStored,
  TipButton,
  useAgents,
  useItems,
  useNow,
  useRepoSettings,
  useStored,
  useSync,
  TEXT_BUTTON_CLASS,
  useViewerState,
  writeStored,
  type Status,
} from "./shared.js";

const STORE = "bb-plugin-github:v4";

function onRowButton(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement && active.dataset.rowButton !== undefined
  );
}

export interface PanelNavigator {
  go: (route: Route, options?: { replace?: boolean }) => void;
  back: (fallback: Route) => void;
}

const COLLAPSED_ISSUE_GROUPS: ReadonlySet<string> = new Set(["closed"]);

function useCollapsed(
  view: InboxView,
): [(groupId: string) => boolean, (groupId: string) => void] {
  const [toggled, setToggled] = useStored(
    `${STORE}:collapsed:${view}`,
    parseCollapsed,
    (value: Set<string>) => JSON.stringify([...value]),
  );
  const defaults: ReadonlySet<string> =
    view === "issues" ? COLLAPSED_ISSUE_GROUPS : COLLAPSED_PULL_GROUPS[view];
  const collapsed = useCallback(
    (groupId: string) => defaults.has(groupId) !== toggled.has(groupId),
    [defaults, toggled],
  );
  const toggle = useCallback(
    (groupId: string) => {
      const next = new Set(toggled);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      setToggled(next);
    },
    [setToggled, toggled],
  );
  return [collapsed, toggle];
}

const asText = (raw: string | null) => raw ?? "";
const keepText = (value: string) => value;

export function lastPullTab(): PullView {
  const stored = readStored(`${STORE}:tab`);
  return stored === "mine" || stored === "all" || stored === "merged"
    ? stored
    : "inbox";
}

export function pullAgentTarget(
  row: PullRowModel,
  viewer: string | null,
): AgentTarget {
  return {
    kind: "pr",
    repo: row.item.repo,
    number: row.item.number,
    title: row.item.title,
    headRefName: row.pr.headRefName,
    baseRefName: row.pr.baseRefName,
    isCrossRepository: row.pr.isCrossRepository,
    preset: pullPreset(row.pr, row.item.author, viewer),
  };
}

const DETAIL_KEYS: Record<string, DetailRequestKind> = {
  a: "agent",
  m: "merge",
  r: "ready",
  s: "status",
  z: "snooze",
  t: "thread",
  c: "copy",
  o: "open",
};

export function PullWorkspace({
  route,
  navigator,
  status,
}: {
  route: Route;
  navigator: PanelNavigator;
  status: Status | null;
}) {
  const bbNavigate = useBbNavigate();
  const {
    login: viewer,
    error: viewerError,
    retry: retryViewer,
  } = useViewerState();
  const agents = useAgents();
  const settings = useRepoSettings();
  const activities = useActivities();
  const sync = useSync();
  const merge = useMerge();
  const changeState = useChangePullState();
  const { snooze, unsnooze } = useSnooze();
  const { items, error, refetch } = useItems("pr");
  const issues = useItems("issue");
  const now = useNow(30_000);
  const compact = useIsCompactViewport();
  const touch = useMediaQuery("(hover: none)");
  const repos = status?.repos ?? [];

  const view: InboxView =
    route.view === "issues"
      ? "issues"
      : route.view === "pulls"
        ? route.tab
        : lastPullTab();
  const openKey =
    route.view === "pull" ? `${route.repo}#${route.number}` : null;
  useEffect(() => {
    if (route.view === "pulls") writeStored(`${STORE}:tab`, route.tab);
  }, [route]);

  const kind = view === "issues" ? "issue" : "pr";
  const [query, setQuery] = useStored(
    `${STORE}:query:${kind}`,
    asText,
    keepText,
  );
  const [filterOpenBy, setFilterOpenBy] = useState(() => ({
    pr: asText(readStored(`${STORE}:query:pr`)).trim().length > 0,
    issue: asText(readStored(`${STORE}:query:issue`)).trim().length > 0,
  }));
  const filterOpen = filterOpenBy[kind];
  const setFilterOpen = useCallback(
    (open: boolean) =>
      setFilterOpenBy((current) => ({ ...current, [kind]: open })),
    [kind],
  );
  const [focusFilter, setFocusFilter] = useState(0);
  const [collapsed, toggleGroup] = useCollapsed(view);
  const [cursor, setCursor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ key: string; step: RowMenuStep } | null>(
    null,
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [agentTarget, setAgentTarget] = useState<AgentTarget | null>(null);
  const [pending, setPending] = useState<{
    key: string;
    kind: DetailRequestKind;
  } | null>(null);
  const [pendingFor, setPendingFor] = useState(openKey);
  if (pendingFor !== openKey) {
    setPendingFor(openKey);
    if (pending !== null && pending.key !== openKey) setPending(null);
  }
  const detailHandle = useRef<PullDetailHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const anchor = useRef<{ key: string | null; requested: string | null }>({
    key: null,
    requested: null,
  });
  const lastIndex = useRef(-1);

  const registerRow = useCallback(
    (key: string, element: HTMLButtonElement | null) => {
      if (element === null) rowButtons.current.delete(key);
      else rowButtons.current.set(key, element);
    },
    [],
  );

  const rows = useMemo(
    () =>
      items === null || viewer === null ? null : pullRowModels(items, viewer),
    [items, viewer],
  );
  const rowByKey = useMemo(
    () => new Map((rows ?? []).map((row) => [row.key, row])),
    [rows],
  );
  useEffect(() => {
    for (const row of rows ?? []) settleActivity(row.key, stateNameOf(row.pr));
  }, [rows]);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const groups = useMemo(
    () =>
      rows === null || view === "issues"
        ? []
        : pullViewGroups(rows, view, parsed, viewer),
    [parsed, rows, view, viewer],
  );
  const count = useMemo(
    () => (rows === null ? null : inboxCount(rows, viewer)),
    [rows, viewer],
  );
  const flat = useMemo(
    () => groups.flatMap((group) => (collapsed(group.id) ? [] : group.rows)),
    [collapsed, groups],
  );
  const visibleCount = groups.reduce(
    (sum, group) => sum + group.rows.length,
    0,
  );
  const cursorRow =
    cursor === null ? null : (flat.find((row) => row.key === cursor) ?? null);

  useEffect(() => {
    const current = openKey ?? cursor;
    if (anchor.current.requested !== null) {
      if (current === anchor.current.requested) {
        anchor.current.requested = null;
      }
    } else {
      anchor.current.key = current;
    }
    const index =
      current === null ? -1 : flat.findIndex((row) => row.key === current);
    if (index >= 0) lastIndex.current = index;
  }, [cursor, flat, openKey]);

  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (openKey === null) {
      scrolledTo.current = null;
      return;
    }
    const element = rowButtons.current.get(openKey);
    if (scrolledTo.current === openKey || element === undefined) return;
    scrolledTo.current = openKey;
    element.scrollIntoView?.({ block: "nearest" });
  }, [openKey, rows]);

  const permissions = useCallback(
    (row: PullRowModel): PullRowPermissions => {
      const write = settings?.[row.item.repo]?.viewerCanWrite === true;
      const own =
        viewer !== null &&
        row.item.author.toLowerCase() === viewer.toLowerCase();
      return {
        canEdit: write || own,
        canMerge: settings?.[row.item.repo] === undefined ? null : write,
        hasAgent: agents.has(`pr:${row.key}`),
      };
    },
    [agents, settings, viewer],
  );

  const focusRow = useCallback((key: string) => {
    setCursor(key);
    anchor.current = { key, requested: null };
    const element = rowButtons.current.get(key);
    if (element !== undefined && document.activeElement !== element) {
      element.focus({ preventScroll: true });
    }
    element?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const openPull = useCallback(
    (repo: string, number: number, replace = false) => {
      setCursor(`${repo}#${number}`);
      setMenu(null);
      navigator.go({ view: "pull", repo, number }, { replace });
    },
    [navigator],
  );
  const closeDetail = useCallback(() => {
    navigator.back({ view: "pulls", tab: view === "issues" ? "inbox" : view });
  }, [navigator, view]);
  useEffect(() => {
    if (cursor === null || openKey !== null) return;
    if (document.activeElement !== document.body) return;
    if (flat.some((row) => row.key === cursor)) return;
    const next = flat[Math.min(lastIndex.current, flat.length - 1)];
    if (next !== undefined) focusRow(next.key);
  }, [cursor, flat, focusRow, openKey]);
  const lastOpen = useRef<string | null>(openKey);
  useEffect(() => {
    const previous = lastOpen.current;
    lastOpen.current = openKey;
    if (openKey === null && previous !== null) focusRow(previous);
  }, [focusRow, openKey]);

  const switchView = useCallback(
    (next: InboxView) => {
      setCursor(null);
      setMenu(null);
      navigator.go(
        next === "issues" ? { view: "issues" } : { view: "pulls", tab: next },
        { replace: true },
      );
    },
    [navigator],
  );

  const agentReturn = useRef<HTMLElement | null>(null);
  const agentReturnTo = useCallback(() => agentReturn.current, []);
  const openAgentSheet = useCallback((target: AgentTarget) => {
    agentReturn.current = null;
    setAgentTarget(target);
  }, []);
  const startAgent = useCallback(
    (row: PullRowModel) => {
      setMenu(null);
      agentReturn.current = rowButtons.current.get(row.key) ?? null;
      setAgentTarget(pullAgentTarget(row, viewer));
    },
    [viewer],
  );
  const openThread = useCallback(
    (row: PullRowModel) => {
      const agent = agents.get(`pr:${row.key}`);
      if (agent === undefined) {
        toast(`No agent works on #${row.item.number} yet`, {
          id: `github-thread-${row.key}`,
        });
        return;
      }
      bbNavigate.toThread(agent.threadId);
    },
    [agents, bbNavigate],
  );

  const actions: PullListActions = useMemo(
    () => ({
      open: (row) => openPull(row.item.repo, row.item.number, openKey !== null),
      point: (row) => {
        setCursor(row.key);
        anchor.current = { key: row.key, requested: null };
        if (onRowButton()) {
          rowButtons.current.get(row.key)?.focus({ preventScroll: true });
        }
      },
      focus: (row) => {
        setCursor(row.key);
        anchor.current = {
          key: row.key,
          requested: anchor.current.requested === row.key ? row.key : null,
        };
      },
      menu: (row, step) => {
        setCursor(row.key);
        setMenu(step === null ? null : { key: row.key, step });
      },
      openMerge: (row) => {
        setMenu(null);
        setPending({ key: row.key, kind: "merge" });
        openPull(row.item.repo, row.item.number, openKey !== null);
      },
      merge: (row, method, deleteBranch) => {
        setMenu(null);
        merge(
          rowMergeTarget(row, permissions(row).canEdit),
          method,
          deleteBranch,
        );
      },
      setState: (row, target) => {
        setMenu(null);
        void changeState(
          {
            repo: row.item.repo,
            number: row.item.number,
            state: rowState(row, currentActivity(row.key)),
          },
          target,
        );
      },
      snooze: (row, choice) => {
        setMenu(null);
        snooze({ repo: row.item.repo, number: row.item.number }, choice);
      },
      unsnooze: (row) => {
        setMenu(null);
        unsnooze({ repo: row.item.repo, number: row.item.number });
      },
      startAgent,
      openThread,
      copyBranch: (row) => copyText(row.pr.headRefName, "branch name"),
      openOnGitHub: (row) => bbNavigate.openUrl(row.item.url),
    }),
    [
      bbNavigate,
      changeState,
      merge,
      openKey,
      openPull,
      openThread,
      permissions,
      snooze,
      startAgent,
      unsnooze,
    ],
  );

  const tabbableKey =
    cursor !== null && flat.some((row) => row.key === cursor)
      ? cursor
      : (flat[0]?.key ?? null);
  const context: PullListContext = {
    viewer,
    showRepo: repos.length > 1,
    split: openKey !== null,
    now,
    cursor,
    openKey,
    tabbableKey,
    menu,
    activities,
    agents,
    permissions,
    touch,
    compact,
    actions,
    registerRow,
  };

  const moveCursor = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      const key = anchor.current.key;
      const at = key === null ? -1 : flat.findIndex((row) => row.key === key);
      let index: number;
      if (at >= 0) {
        index = Math.max(0, Math.min(flat.length - 1, at + delta));
      } else if (key !== null && lastIndex.current >= 0) {
        index =
          delta > 0
            ? Math.min(lastIndex.current, flat.length - 1)
            : Math.max(0, Math.min(lastIndex.current, flat.length) - 1);
      } else {
        index = delta > 0 ? 0 : flat.length - 1;
      }
      const next = flat[index];
      if (next === undefined) return;
      anchor.current = { key: next.key, requested: next.key };
      lastIndex.current = index;
      if (openKey !== null) {
        openPull(next.item.repo, next.item.number, true);
        const element = rowButtons.current.get(next.key);
        element?.focus({ preventScroll: true });
        element?.scrollIntoView?.({ block: "nearest" });
        return;
      }
      focusRow(next.key);
      anchor.current = { key: next.key, requested: next.key };
    },
    [flat, focusRow, openKey, openPull],
  );

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const root = rootRef.current;
      const target = event.target;
      if (root === null) return;
      if (
        target !== document.body &&
        !(target instanceof Node && root.contains(target))
      ) {
        return;
      }
      if (isTyping(target) || agentTarget !== null || helpOpen) return;
      const element = target instanceof HTMLElement ? target : null;
      const onRow = element?.dataset.rowButton !== undefined;
      const onControl =
        element !== null &&
        element !== document.body &&
        element.closest("button, a, [role='button'], [role='tab']") !== null;
      if ((event.key === "Enter" || event.key === " ") && onControl && !onRow) {
        return;
      }
      const inDetail = element?.closest("[data-github-detail]") != null;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handled = () => event.preventDefault();

      if (event.key === "Escape") {
        if (openKey !== null) closeDetail();
        else if (cursor !== null) {
          setCursor(null);
          if (element !== null && onRow) element.blur();
        } else return;
        handled();
        return;
      }
      if (event.key === "?") {
        setHelpOpen(true);
        handled();
        return;
      }
      if (event.shiftKey) return;
      if (key === "/") {
        setFilterOpen(true);
        setFocusFilter((value) => value + 1);
        handled();
        return;
      }
      const sideways =
        (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
        openKey === null &&
        (onRow || target === document.body);
      if (key === "[" || key === "]" || sideways) {
        const forward = key === "]" || event.key === "ArrowRight";
        const at = INBOX_VIEWS.findIndex((entry) => entry.id === view);
        const next =
          INBOX_VIEWS[
            (at + (forward ? 1 : -1) + INBOX_VIEWS.length) % INBOX_VIEWS.length
          ];
        if (next !== undefined) switchView(next.id);
        handled();
        return;
      }
      if (view === "issues") return;
      if (key === "j" || (event.key === "ArrowDown" && !inDetail)) {
        moveCursor(1);
        handled();
        return;
      }
      if (key === "k" || (event.key === "ArrowUp" && !inDetail)) {
        moveCursor(-1);
        handled();
        return;
      }
      if (event.key === "Enter") {
        if (cursorRow !== null && openKey === null) {
          actions.open(cursorRow);
          handled();
        }
        return;
      }
      const request = DETAIL_KEYS[key];
      if (request === undefined) return;
      handled();
      if (openKey !== null) {
        detailHandle.current?.run(request);
        return;
      }
      const row = cursorRow;
      if (row === null) return;
      const rowPermissions = permissions(row);
      const state = rowState(row, activities.get(row.key) ?? null);
      const live = state === "OPEN" || state === "DRAFT";
      switch (request) {
        case "agent":
          if (live) startAgent(row);
          return;
        case "merge": {
          if (!live) return;
          if (rowMergeable(row, rowPermissions)) {
            focusRow(row.key);
            setMenu({ key: row.key, step: "merge" });
            return;
          }
          const blocked =
            hardMergeBlock(row.pr) ??
            (rowPermissions.canMerge === false
              ? `You can't merge in ${row.item.repo}`
              : null);
          if (blocked !== null) {
            toast(`#${row.item.number} can't be merged yet`, {
              id: `github-merge-${row.key}`,
              description: blocked,
            });
            return;
          }
          actions.openMerge(row);
          return;
        }
        case "ready":
          if (state !== "DRAFT") return;
          if (rowPermissions.canEdit) actions.setState(row, "open");
          else {
            toast(`You can't change #${row.item.number}`, {
              id: `github-state-${row.key}`,
            });
          }
          return;
        case "status":
          if (state === "MERGED") return;
          focusRow(row.key);
          setMenu({ key: row.key, step: "main" });
          return;
        case "snooze":
          if (!live) return;
          focusRow(row.key);
          setMenu({ key: row.key, step: "snooze" });
          return;
        case "thread":
          openThread(row);
          return;
        case "copy":
          actions.copyBranch(row);
          return;
        case "open":
          actions.openOnGitHub(row);
          return;
      }
    },
    [
      actions,
      activities,
      agentTarget,
      closeDetail,
      cursor,
      cursorRow,
      focusRow,
      helpOpen,
      moveCursor,
      openKey,
      openThread,
      permissions,
      setFilterOpen,
      startAgent,
      switchView,
      view,
    ],
  );
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onKey]);

  const closeFilter = useCallback(() => {
    setQuery("");
    setFilterOpen(false);
  }, [setFilterOpen, setQuery]);

  const loading = items === null && error === null;
  const listLoading =
    view === "issues"
      ? issues.items === null && issues.error === null
      : loading;
  const openRow = openKey === null ? null : (rowByKey.get(openKey) ?? null);
  const chain =
    openRow?.chain == null
      ? null
      : openRow.chain.flatMap((number) => {
          const row = rowByKey.get(`${openRow.item.repo}#${number}`);
          return row === undefined ? [] : [row];
        });
  const lastError =
    status === null
      ? null
      : (status.lastSyncError ??
        (status.ghState === "unavailable"
          ? (status.ghError ?? "GitHub is unreachable")
          : null));

  const listBody =
    view === "issues" ? (
      <IssuesPane
        items={issues.items}
        error={issues.error}
        onRetry={issues.refetch}
        query={query}
        viewer={viewer}
        showRepo={repos.length > 1}
        now={now}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        onOpen={(item) =>
          navigator.go({ view: "issue", repo: item.repo, number: item.number })
        }
        onStartAgent={openAgentSheet}
        onClearFilter={() => {
          setQuery("");
          setFilterOpen(false);
        }}
      />
    ) : error !== null && items === null ? (
      <ListMessage
        icon="CloudOff"
        title="Can't reach GitHub"
        detail="The pull requests show up as soon as the connection is back."
        action={
          <Button type="button" size="sm" variant="ghost" onClick={refetch}>
            Try again
          </Button>
        }
      />
    ) : viewerError !== null && rows === null ? (
      <ListMessage
        icon="CloudOff"
        title="Can't tell which pull requests are yours"
        detail="GitHub didn't say who you're signed in as. The lists show up as soon as it does."
        action={
          <Button type="button" size="sm" variant="ghost" onClick={retryViewer}>
            Try again
          </Button>
        }
      />
    ) : rows === null ? (
      <ListSkeleton />
    ) : (
      <PullList
        groups={groups}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        context={context}
        empty={
          query.trim().length > 0 ? (
            <NoMatch
              noun="pull requests"
              query={query}
              viewer={viewer}
              onClear={closeFilter}
            />
          ) : view === "inbox" ? (
            <ListMessage
              icon="CircleCheck"
              title="Nothing needs you"
              detail="No review is waiting on you, and your pull requests are on track."
            />
          ) : (
            <ListMessage
              icon="GitPullRequest"
              title="No pull requests here"
              detail="They show up here as soon as they're opened."
            />
          )
        }
      />
    );

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      {sync.syncing ? (
        <div
          role="progressbar"
          aria-label="Syncing with GitHub"
          className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden"
        >
          <div className="animate-indeterminate-progress h-full w-1/3 rounded-full bg-muted-foreground" />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div
          className={`relative min-w-0 flex-col ${
            openKey === null
              ? "flex flex-1"
              : "hidden border-r border-border @min-[60rem]/github:flex @min-[60rem]/github:max-w-135 @min-[60rem]/github:basis-[44%]"
          }`}
        >
          <div className={HEADER_CLASS}>
            <ViewTabs view={view} count={count} onView={switchView} />
            <TipButton
              label="Filter"
              keys={["/"]}
              icon="Search"
              onClick={() => {
                setFilterOpen(true);
                setFocusFilter((value) => value + 1);
              }}
            />
            {view === "issues" ? (
              <TipButton
                label="New issue"
                icon="Plus"
                onClick={() => navigator.go({ view: "new" })}
              />
            ) : null}
          </div>
          {filterOpen ? (
            <div className="flex shrink-0 items-center px-2 pt-2 pb-1">
              <FilterInput
                value={query}
                onChange={setQuery}
                onClose={closeFilter}
                onExit={() => {
                  const first = flat[0];
                  if (first === undefined) return false;
                  focusRow(first.key);
                  return true;
                }}
                items={view === "issues" ? issues.items : items}
                kind={kind}
                repos={repos}
                viewer={viewer}
                focusRequest={focusFilter}
              />
            </div>
          ) : null}
          <FilterChips
            query={query}
            viewer={viewer}
            inset={!filterOpen}
            count={
              view === "issues" || rows === null || visibleCount === 0
                ? null
                : visibleCount
            }
            noun={
              kind === "pr"
                ? ["pull request", "pull requests"]
                : ["issue", "issues"]
            }
            onChange={(next) => {
              setQuery(next);
              if (next.trim().length === 0) setFilterOpen(false);
            }}
            onEmptied={() =>
              rootRef.current
                ?.querySelector<HTMLElement>("[data-row-button]")
                ?.focus({ preventScroll: true })
            }
          />
          {lastError !== null && items !== null ? (
            <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border py-1 pr-2 pl-4 text-xs text-subtle-foreground">
              <Icon name="CloudOff" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Can't reach GitHub · showing the last sync
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={TEXT_BUTTON_CLASS}
                disabled={sync.syncing}
                onClick={sync.refresh}
              >
                Try again
              </Button>
            </div>
          ) : null}
          <div
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-10"
            aria-busy={listLoading}
          >
            {listBody}
          </div>
          <span className="sr-only" role="status">
            {listLoading
              ? `Loading ${view === "issues" ? "issues" : "pull requests"}`
              : ""}
          </span>
        </div>
        {route.view === "pull" ? (
          <div
            data-github-detail
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <PullDetailView
              key={openKey}
              repo={route.repo}
              number={route.number}
              row={openRow}
              chain={chain}
              viewer={viewer}
              layout="split"
              environmentId={null}
              handle={detailHandle}
              pendingRequest={
                pending !== null && pending.key === openKey
                  ? pending.kind
                  : null
              }
              onBack={closeDetail}
              onClose={closeDetail}
              onOpenPull={(repo, number) => openPull(repo, number, true)}
              onStartAgent={openAgentSheet}
            />
          </div>
        ) : null}
      </div>
      <AgentSheet
        target={agentTarget}
        returnFocusTo={agentReturnTo}
        onOpenChange={(open) => {
          if (!open) setAgentTarget(null);
        }}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
