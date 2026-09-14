import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  useBbContext,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Input } from "@bb/shared-ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type {
  CommitDetailOutput,
  gitGraphRpcContract,
  HistoryCommit,
  OverviewOutput,
  ProjectsOutput,
  RepoStatusOutput,
  RepoSummary,
} from "./contract.js";
import { BranchPicker } from "./components/branch-picker.js";
import {
  CommitDetail,
  type FilePatchState,
} from "./components/commit-detail.js";
import { UncommittedCard } from "./components/uncommitted-card.js";
import { relativeTime } from "./components/format.js";
import { GraphLanes, type GraphNodeKind } from "./components/graph-canvas.js";
import { RefPills, refChipLimit } from "./components/ref-pills.js";
import {
  GRAPH_PADDING_LEFT,
  graphColumnWidth,
  ROW_HEIGHT,
} from "./graph/geometry.js";
import {
  ancestorsOf,
  computeGraphEdges,
  computeGraphLayout,
  restrictToLoadedParents,
  type LayoutCommit,
} from "./graph/layout.js";
import {
  readLastProjectRoute,
  trackLastProjectRoute,
  writeLastProjectRoute,
} from "./project-origin.js";

const HISTORY_PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 350;
const OVERSCAN_ROWS = 12;
const TEXT_COLUMNS_MIN_WIDTH = 160;
const ROOT_REPO_SELECT_VALUE = "⁣root";
const UNCOMMITTED_CHANGES_KEY = "⁣uncommitted";
const REMOTE_REF_PREFIX = "refs/remotes/";
const DESCRIPTION_COLUMN_CLASS =
  "flex min-w-0 flex-1 items-center gap-1.5 pl-2";
const AUTHOR_COLUMN_CLASS = "hidden w-28 shrink-0 truncate pl-3 @xl:block";
const DATE_COLUMN_CLASS =
  "hidden w-20 shrink-0 truncate pl-2 pr-3 text-right tabular-nums @sm:block";

function repoSelectValue(relPath: string): string {
  return relPath.length === 0 ? ROOT_REPO_SELECT_VALUE : relPath;
}

function relPathFromSelectValue(value: string): string {
  return value === ROOT_REPO_SELECT_VALUE ? "" : value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repoDisplayName(repo: RepoSummary): string {
  const base =
    repo.position === "root"
      ? "(project root)"
      : repo.position === "enclosing"
        ? `${repo.relPath} (above root)`
        : repo.relPath;
  const suffix =
    repo.gitLink === "submodule"
      ? " · submodule"
      : repo.gitLink === "worktree"
        ? " · worktree"
        : "";
  return `${base}${suffix}`;
}

function rowStateClass(selected: boolean, dimmed: boolean): string {
  if (selected) return "bg-accent";
  if (dimmed) return "opacity-40 hover:bg-accent/50 hover:opacity-100";
  return "hover:bg-accent/50";
}

function GraphSkeleton() {
  return (
    <div className="space-y-px p-2">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-1 py-2">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <EmptyState message={message} icon="AlertCircle" />
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function GitGraphPanel({ subPath: _subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof gitGraphRpcContract>();
  const bbContext = useBbContext();

  const [projects, setProjects] = useState<ProjectsOutput["projects"] | null>(
    null,
  );
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsNonce, setProjectsNonce] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewOutput | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewRefreshNonce, setOverviewRefreshNonce] = useState(0);

  const [repoRelPath, setRepoRelPath] = useState<string | null>(null);
  const [branchRefs, setBranchRefs] = useState<string[]>([]);
  const [includeRemotes, setIncludeRemotes] = useState(false);
  const [status, setStatus] = useState<RepoStatusOutput | null>(null);
  const [statusNonce, setStatusNonce] = useState(0);

  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [repoIsEmpty, setRepoIsEmpty] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [historyNonce, setHistoryNonce] = useState(0);

  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetailOutput | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [patch, setPatch] = useState<FilePatchState | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);

  const [hoverHash, setHoverHash] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [descriptionWidth, setDescriptionWidth] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const commitsRef = useRef(0);
  commitsRef.current = commits.length;

  useEffect(() => {
    let cancelled = false;
    rpc.call("projects", null).then(
      (result) => {
        if (cancelled) return;
        setProjects(result.projects);
        setProjectsError(null);
      },
      (error: unknown) => {
        if (cancelled) return;
        setProjectsError(errorText(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectsNonce]);

  useEffect(() => {
    if (projects === null || projectsError !== null) return;
    if (projectId !== null && projects.some((p) => p.id === projectId)) return;
    const stored = readLastProjectRoute();
    const storedMatch =
      stored !== null && projects.some((p) => p.id === stored) ? stored : null;
    const contextMatch =
      bbContext.projectId !== null &&
      projects.some((p) => p.id === bbContext.projectId)
        ? bbContext.projectId
        : null;
    const fallback = projects.find((p) => p.sources.length > 0) ?? projects[0];
    setProjectId(storedMatch ?? contextMatch ?? fallback?.id ?? null);
  }, [projects, projectsError, projectId, bbContext.projectId]);

  useEffect(() => {
    if (projects === null) return;
    const project = projects.find((p) => p.id === projectId);
    if (project === undefined) return;
    if (
      sourceId !== null &&
      project.sources.some((source) => source.id === sourceId)
    ) {
      return;
    }
    const fallback =
      project.sources.find((source) => source.isDefault) ?? project.sources[0];
    setSourceId(fallback !== undefined ? fallback.id : null);
  }, [projects, projectId, sourceId]);

  const loadOverview = useCallback(
    async (refresh: boolean) => {
      if (projectId === null) {
        setOverviewLoading(false);
        return;
      }
      setOverviewLoading(true);
      setOverviewError(null);
      try {
        const result = await rpc.call("overview", {
          projectId,
          ...(sourceId !== null ? { sourceId } : {}),
          refresh,
        });
        setOverview(result);
      } catch (error) {
        setOverview(null);
        setOverviewError(errorText(error));
      } finally {
        setOverviewLoading(false);
      }
    },
    [rpc, projectId, sourceId],
  );

  useEffect(() => {
    void loadOverview(false);
  }, [loadOverview]);

  useEffect(() => {
    if (overviewRefreshNonce === 0) return;
    void loadOverview(true);
  }, [overviewRefreshNonce, loadOverview]);

  useEffect(() => {
    if (overview === null) return;
    if (overview.repos.some((r) => r.relPath === repoRelPath)) return;
    const root =
      overview.repos.find((r) => r.position === "root") ?? overview.repos[0];
    setRepoRelPath(root !== undefined ? root.relPath : null);
  }, [overview, repoRelPath]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setAppliedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (projectId === null || repoRelPath === null || sourceId === null) {
      return;
    }
    let cancelled = false;
    setCommits([]);
    setSelectedHash(null);
    setDetail(null);
    setOpenFilePath(null);
    setPatch(null);
    setRepoIsEmpty(false);
    setHasMore(false);
    setHistoryError(null);
    setScrollTop(0);
    setHistoryLoading(true);
    rpc
      .call("history", {
        projectId,
        sourceId,
        repoRelPath,
        offset: 0,
        limit: HISTORY_PAGE_SIZE,
        includeRemotes,
        refs: branchRefs,
        ...(appliedQuery.length > 0 ? { query: appliedQuery } : {}),
      })
      .then(
        (result) => {
          if (cancelled) return;
          setRepoIsEmpty(result.empty);
          setCommits(result.commits);
          setHasMore(result.commits.length === HISTORY_PAGE_SIZE);
        },
        (error: unknown) => {
          if (cancelled) return;
          setCommits([]);
          setHistoryError(errorText(error));
        },
      )
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    rpc,
    projectId,
    sourceId,
    repoRelPath,
    branchRefs,
    includeRemotes,
    appliedQuery,
    historyNonce,
  ]);

  const loadMore = useCallback(async () => {
    if (
      projectId === null ||
      sourceId === null ||
      repoRelPath === null ||
      loadingMore ||
      historyLoading
    ) {
      return;
    }
    setLoadingMore(true);
    try {
      const result = await rpc.call("history", {
        projectId,
        sourceId,
        repoRelPath,
        offset: commitsRef.current,
        limit: HISTORY_PAGE_SIZE,
        includeRemotes,
        refs: branchRefs,
        ...(appliedQuery.length > 0 ? { query: appliedQuery } : {}),
      });
      setCommits((previous) => [...previous, ...result.commits]);
      setHasMore(result.commits.length === HISTORY_PAGE_SIZE);
    } catch (error) {
      toast.error("Failed to load more commits", {
        description: errorText(error),
      });
    } finally {
      setLoadingMore(false);
    }
  }, [
    rpc,
    projectId,
    sourceId,
    repoRelPath,
    branchRefs,
    includeRemotes,
    appliedQuery,
    loadingMore,
    historyLoading,
  ]);

  useEffect(() => {
    if (projectId === null || repoRelPath === null) return;
    let cancelled = false;
    setStatus(null);
    rpc
      .call("repoStatus", {
        projectId,
        ...(sourceId !== null ? { sourceId } : {}),
        repoRelPath,
      })
      .then(
        (result) => {
          if (!cancelled) setStatus(result);
        },
        () => {
          if (!cancelled) setStatus(null);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, sourceId, repoRelPath, statusNonce]);

  useEffect(() => {
    if (status === null || status.error !== null) return;
    const known = new Set(status.branches.map((branch) => branch.fullName));
    setBranchRefs((current) =>
      current.every((ref) => known.has(ref))
        ? current
        : current.filter((ref) => known.has(ref)),
    );
  }, [status]);

  useEffect(() => {
    if (
      selectedHash === null ||
      selectedHash === UNCOMMITTED_CHANGES_KEY ||
      projectId === null ||
      repoRelPath === null
    ) {
      return;
    }
    let cancelled = false;
    setDetail(null);
    setPatch(null);
    setPatchError(null);
    setOpenFilePath(null);
    setDetailLoading(true);
    rpc
      .call("commitDetail", {
        projectId,
        ...(sourceId !== null ? { sourceId } : {}),
        repoRelPath,
        hash: selectedHash,
      })
      .then(
        (result) => {
          if (!cancelled) setDetail(result);
        },
        (error: unknown) => {
          if (!cancelled) {
            setDetail(null);
            toast.error("Failed to load commit", {
              description: errorText(error),
            });
          }
        },
      )
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, sourceId, repoRelPath, selectedHash]);

  useEffect(() => {
    if (
      openFilePath === null ||
      selectedHash === null ||
      projectId === null ||
      repoRelPath === null
    ) {
      return;
    }
    let cancelled = false;
    setPatch(null);
    setPatchError(null);
    setPatchLoading(true);
    rpc
      .call("filePatch", {
        projectId,
        ...(sourceId !== null ? { sourceId } : {}),
        repoRelPath,
        hash: selectedHash,
        path: openFilePath,
      })
      .then(
        (result) => {
          if (!cancelled) setPatch({ ...result, path: openFilePath });
        },
        (error: unknown) => {
          if (!cancelled) setPatchError(errorText(error));
        },
      )
      .finally(() => {
        if (!cancelled) setPatchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, sourceId, repoRelPath, selectedHash, openFilePath]);

  const dirty = status?.dirty ?? null;
  const headCommitHash = useMemo(
    () =>
      commits.find((commit) => commit.refs.some((ref) => ref.isHead))?.hash ??
      null,
    [commits],
  );
  const uncommittedParent =
    dirty !== null && dirty.total > 0 && appliedQuery.length === 0
      ? headCommitHash
      : null;
  const rowOffset = uncommittedParent === null ? 0 : 1;
  const graphCommits = useMemo<readonly LayoutCommit[]>(() => {
    const loaded =
      appliedQuery.length > 0 ? restrictToLoadedParents(commits) : commits;
    return uncommittedParent === null
      ? loaded
      : [
          { hash: UNCOMMITTED_CHANGES_KEY, parents: [uncommittedParent] },
          ...loaded,
        ];
  }, [commits, appliedQuery, uncommittedParent]);
  const nodeKinds = useMemo(() => {
    const kinds: GraphNodeKind[] =
      uncommittedParent === null ? [] : ["uncommitted"];
    for (const commit of commits) {
      kinds.push(
        commit.refs.some((ref) => ref.isHead)
          ? "head"
          : commit.parents.length > 1
            ? "merge"
            : "commit",
      );
    }
    return kinds;
  }, [commits, uncommittedParent]);
  const layout = useMemo(
    () => computeGraphLayout(graphCommits),
    [graphCommits],
  );
  const graphEdges = useMemo(
    () => computeGraphEdges(graphCommits, layout),
    [graphCommits, layout],
  );
  const graphWidth = graphColumnWidth(layout.maxLane);
  const chipLimit = refChipLimit(descriptionWidth);
  const focusHash = selectedHash ?? hoverHash;
  const highlightChain = useMemo(
    () =>
      focusHash !== null &&
      graphCommits.some((commit) => commit.hash === focusHash)
        ? ancestorsOf(graphCommits, focusHash)
        : null,
    [graphCommits, focusHash],
  );

  const totalRows = layout.rows.length;
  const renderFrom = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS,
  );
  const visibleCount =
    Math.ceil(
      Math.max(viewportHeight, ROW_HEIGHT * OVERSCAN_ROWS) / ROW_HEIGHT,
    ) +
    OVERSCAN_ROWS * 2;
  const renderTo = Math.min(totalRows, renderFrom + visibleCount);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) return;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight);
  }, []);

  const attachScroller = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      scrollRef.current = null;
    };
  }, []);

  const observeDescriptionColumn = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => {
        setDescriptionWidth(element.clientWidth);
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
    [],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (element !== null) {
      setViewportHeight(element.clientHeight);
    }
  }, [historyLoading, totalRows]);

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    if (
      typeof IntersectionObserver === "undefined" ||
      sentinelRef.current === null ||
      scrollRef.current === null
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const scroller = scrollRef.current;
        if (scroller === null) return;
        const fillsViewport =
          scroller.scrollHeight >= scroller.clientHeight + 200;
        if (fillsViewport && entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRef.current();
        }
      },
      { root: scrollRef.current, rootMargin: "600px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, historyLoading, repoRelPath, appliedQuery]);

  const handleRefresh = useCallback(() => {
    setOverviewRefreshNonce((nonce) => nonce + 1);
    setStatusNonce((nonce) => nonce + 1);
    setHistoryNonce((nonce) => nonce + 1);
  }, []);

  const handleSelectCommit = useCallback((hash: string) => {
    setSelectedHash((current) => (current === hash ? null : hash));
  }, []);

  const handleCopyHash = useCallback((hash: string) => {
    try {
      void navigator.clipboard?.writeText(hash).then(() => {
        toast.success("Commit hash copied");
      });
    } catch {}
  }, []);

  const handleOpenFile = useCallback((path: string) => {
    setOpenFilePath((current) => (current === path ? null : path));
  }, []);

  const resetRepositoryView = useCallback(() => {
    setOverview(null);
    setOverviewError(null);
    setRepoRelPath(null);
    setBranchRefs([]);
    setStatus(null);
    setCommits([]);
    setHistoryError(null);
    setRepoIsEmpty(false);
    setHasMore(false);
    setSelectedHash(null);
    setDetail(null);
    setOpenFilePath(null);
    setPatch(null);
  }, []);

  const handleProjectChange = useCallback(
    (nextProjectId: string) => {
      const nextProject = projects?.find(
        (project) => project.id === nextProjectId,
      );
      const nextSource =
        nextProject?.sources.find((source) => source.isDefault) ??
        nextProject?.sources[0] ??
        null;

      resetRepositoryView();
      setProjectId(nextProjectId);
      setSourceId(nextSource?.id ?? null);
    },
    [projects, resetRepositoryView],
  );

  const handleSourceChange = useCallback(
    (nextSourceId: string) => {
      resetRepositoryView();
      setSourceId(nextSourceId);
    },
    [resetRepositoryView],
  );

  const activeProject = projects?.find((p) => p.id === projectId) ?? null;
  const activeRepo =
    overview?.repos.find((r) => r.relPath === repoRelPath) ?? null;
  const selectableBranches = (status?.branches ?? []).filter(
    (branch) => includeRemotes || !branch.isRemote,
  );
  const handleIncludeRemotesChange = useCallback((checked: boolean) => {
    if (!checked) {
      setBranchRefs((current) =>
        current.some((ref) => ref.startsWith(REMOTE_REF_PREFIX))
          ? current.filter((ref) => !ref.startsWith(REMOTE_REF_PREFIX))
          : current,
      );
    }
    setIncludeRemotes(checked);
  }, []);

  const renderRow = (index: number): ReactNode => {
    if (index < rowOffset) {
      const isSelected = selectedHash === UNCOMMITTED_CHANGES_KEY;
      const dimmed =
        highlightChain !== null && !highlightChain.has(UNCOMMITTED_CHANGES_KEY);
      return (
        <div
          key={UNCOMMITTED_CHANGES_KEY}
          role="listitem"
          data-testid="git-graph-uncommitted"
          className="absolute inset-x-0"
          style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
        >
          <button
            type="button"
            onClick={() => handleSelectCommit(UNCOMMITTED_CHANGES_KEY)}
            onMouseEnter={() => setHoverHash(UNCOMMITTED_CHANGES_KEY)}
            onMouseLeave={() =>
              setHoverHash((current) =>
                current === UNCOMMITTED_CHANGES_KEY ? null : current,
              )
            }
            className={`flex h-full w-full items-center text-left transition-opacity duration-150 ${rowStateClass(isSelected, dimmed)}`}
            aria-current={isSelected ? "true" : undefined}
          >
            <span
              aria-hidden="true"
              data-testid="git-graph-row-graph"
              className="shrink-0"
              style={{ width: graphWidth }}
            />
            <span className={DESCRIPTION_COLUMN_CLASS}>
              <span className="truncate text-sm font-medium text-[color:color-mix(in_oklab,#f59e0b_72%,var(--foreground))]">
                Uncommitted changes
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {dirty?.total ?? 0}
                {dirty?.truncated === true ? "+" : ""} changed
              </span>
            </span>
            <span className={AUTHOR_COLUMN_CLASS} />
            <span
              className={`${DATE_COLUMN_CLASS} text-xs text-muted-foreground`}
            >
              —
            </span>
          </button>
        </div>
      );
    }
    const commit = commits[index - rowOffset];
    if (commit === undefined) return null;
    const isSelected = selectedHash === commit.hash;
    const dimmed = highlightChain !== null && !highlightChain.has(commit.hash);
    return (
      <div
        key={commit.hash}
        role="listitem"
        data-testid="git-graph-row"
        className="absolute inset-x-0"
        style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
      >
        <button
          type="button"
          onClick={() => handleSelectCommit(commit.hash)}
          onMouseEnter={() => setHoverHash(commit.hash)}
          onMouseLeave={() =>
            setHoverHash((current) =>
              current === commit.hash ? null : current,
            )
          }
          className={`flex h-full w-full items-center text-left transition-opacity duration-150 ${rowStateClass(isSelected, dimmed)}`}
          aria-current={isSelected ? "true" : undefined}
        >
          <span
            aria-hidden="true"
            data-testid="git-graph-row-graph"
            className="shrink-0"
            style={{ width: graphWidth }}
          />
          <span className={DESCRIPTION_COLUMN_CLASS}>
            <RefPills refs={commit.refs} maxVisible={chipLimit} />
            <span
              className="min-w-0 flex-1 truncate text-sm"
              title={commit.subject}
            >
              {commit.subject}
            </span>
          </span>
          <span
            className={`${AUTHOR_COLUMN_CLASS} text-xs text-muted-foreground`}
            title={`${commit.authorName} <${commit.authorEmail}>`}
          >
            {commit.authorName}
          </span>
          <span
            className={`${DATE_COLUMN_CLASS} text-xs text-muted-foreground`}
            title={commit.authorDate}
          >
            {relativeTime(commit.authorDate)}
          </span>
        </button>
      </div>
    );
  };

  let listBody: ReactNode;
  if (projectsError !== null) {
    listBody = (
      <ErrorState
        message={projectsError}
        onRetry={() => setProjectsNonce((nonce) => nonce + 1)}
      />
    );
  } else if (projects === null) {
    listBody = <GraphSkeleton />;
  } else if (projects.length === 0) {
    listBody = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState message="No BB projects yet. Create a project that points at a Git checkout." />
      </div>
    );
  } else if (overviewLoading && overview === null) {
    listBody = <GraphSkeleton />;
  } else if (overviewError !== null) {
    listBody = (
      <ErrorState
        message={overviewError}
        onRetry={() => setOverviewRefreshNonce((nonce) => nonce + 1)}
      />
    );
  } else if (overview === null || overview.repos.length === 0) {
    listBody = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon="FolderGit"
          message={
            overview?.scanError ??
            (projects.length === 0
              ? "No BB projects yet. Create a project that points at a Git checkout."
              : `No Git repositories found under ${overview?.source.path ?? "the project folder"}.`)
          }
        />
      </div>
    );
  } else if (repoRelPath === null) {
    listBody = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState message="Select a repository to view its graph." />
      </div>
    );
  } else if (historyLoading) {
    listBody = <GraphSkeleton />;
  } else if (historyError !== null) {
    listBody = (
      <ErrorState
        message={historyError}
        onRetry={() => setHistoryNonce((nonce) => nonce + 1)}
      />
    );
  } else if (repoIsEmpty) {
    listBody = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState message="This repository has no commits yet." />
      </div>
    );
  } else if (commits.length === 0) {
    listBody = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          message={
            appliedQuery.length > 0
              ? `No commits match “${appliedQuery}”.`
              : "No commits found."
          }
        />
      </div>
    );
  } else {
    const rowIndexes = Array.from(
      { length: Math.max(0, renderTo - renderFrom) },
      (_, offset) => renderFrom + offset,
    );
    listBody = (
      <>
        <div
          ref={attachScroller}
          onScroll={handleScroll}
          data-testid="git-graph-scroller"
          className="@container min-h-0 flex-1 overflow-auto"
        >
          <div style={{ minWidth: graphWidth + TEXT_COLUMNS_MIN_WIDTH }}>
            <div
              data-testid="git-graph-header"
              className="sticky top-0 z-20 flex h-7 items-center border-b border-border bg-background text-xs font-medium text-muted-foreground"
            >
              <div
                data-testid="git-graph-header-graph"
                className="shrink-0 truncate"
                style={{ width: graphWidth, paddingLeft: GRAPH_PADDING_LEFT }}
              >
                Graph
              </div>
              <div
                ref={observeDescriptionColumn}
                className={DESCRIPTION_COLUMN_CLASS}
              >
                <span className="truncate">Description</span>
              </div>
              <div className={AUTHOR_COLUMN_CLASS}>Author</div>
              <div className={DATE_COLUMN_CLASS}>Date</div>
            </div>
            <div
              role="list"
              className="relative"
              style={{ height: totalRows * ROW_HEIGHT }}
            >
              {rowIndexes.map(renderRow)}
              <GraphLanes
                layout={layout}
                edges={graphEdges.edges}
                openEdges={graphEdges.openEdges}
                nodeKinds={nodeKinds}
                renderFrom={renderFrom}
                renderTo={renderTo}
                width={graphWidth}
                highlightChain={highlightChain}
              />
            </div>
          </div>
          <div ref={sentinelRef} aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span className="truncate">
            {commits.length} commit{commits.length === 1 ? "" : "s"}
            {appliedQuery.length > 0 ? ` matching “${appliedQuery}”` : ""}
            {activeRepo?.head !== null && activeRepo !== null
              ? ` · HEAD ${activeRepo.head?.branch ?? activeRepo.head?.abbrev}`
              : ""}
          </span>
          {hasMore ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {projects !== null && projects.length > 1 ? (
          <Select value={projectId ?? ""} onValueChange={handleProjectChange}>
            <SelectTrigger
              className="h-8 w-40 shrink-0 text-xs"
              aria-label="Project"
            >
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {activeProject !== null && activeProject.sources.length > 1 ? (
          <Select value={sourceId ?? ""} onValueChange={handleSourceChange}>
            <SelectTrigger
              className="h-8 min-w-0 max-w-64 flex-1 shrink text-xs"
              aria-label="Folder source"
            >
              <SelectValue placeholder="Folder source" />
            </SelectTrigger>
            <SelectContent>
              {activeProject.sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{source.path}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {source.isDefault ? "· default · " : "· "}
                      {source.hostName}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {overview !== null && overview.repos.length > 0 ? (
          <Select
            value={repoRelPath === null ? "" : repoSelectValue(repoRelPath)}
            onValueChange={(value) => {
              setBranchRefs([]);
              setRepoRelPath(relPathFromSelectValue(value));
            }}
          >
            <SelectTrigger
              className="h-8 min-w-44 max-w-72 flex-1 shrink text-xs"
              aria-label="Repository"
            >
              <SelectValue placeholder="Repository" />
            </SelectTrigger>
            <SelectContent>
              {overview.repos.map((repo) => (
                <SelectItem
                  key={repo.relPath}
                  value={repoSelectValue(repo.relPath)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{repoDisplayName(repo)}</span>
                    {repo.head !== null ? (
                      <span className="shrink-0 text-muted-foreground">
                        {repo.head.branch ?? repo.head.abbrev}
                        {repo.empty ? " (empty)" : ""}
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {overview !== null && overview.repos.length > 0 ? (
          <BranchPicker
            branches={selectableBranches}
            selected={branchRefs}
            onChange={setBranchRefs}
          />
        ) : null}
        <label
          className="flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground"
          title="Include remote-tracking branches in Show All and the branch selector"
        >
          <Checkbox
            checked={includeRemotes}
            onCheckedChange={(checked) =>
              handleIncludeRemotesChange(checked === true)
            }
          />
          Show remote branches
        </label>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commit messages…"
          aria-label="Search commit messages"
          className="h-8 w-44 shrink-0 text-xs sm:w-56"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-2.5 text-xs"
          onClick={handleRefresh}
          disabled={projectId === null || overviewLoading}
        >
          Refresh
        </Button>
        {dirty !== null && status?.error === null ? (
          <Badge
            variant={dirty.conflicted > 0 ? "destructive" : "outline"}
            className="shrink-0 font-normal"
            title={`${dirty.staged} staged, ${dirty.unstaged} unstaged, ${dirty.untracked} untracked, ${dirty.conflicted} conflicted${dirty.truncated ? " (list truncated)" : ""}`}
          >
            {dirty.total}
            {dirty.truncated ? "+" : ""} changed
          </Badge>
        ) : null}
        {status !== null && status.error === null && dirty === null ? (
          <Badge
            variant="outline"
            className="shrink-0 font-normal text-emerald-500"
          >
            Clean
          </Badge>
        ) : null}
        {overview !== null ? (
          <span
            className="hidden max-w-72 truncate text-xs text-muted-foreground lg:inline"
            title={`${overview.source.path} on ${overview.source.hostName}`}
          >{`${overview.source.path} @ ${overview.source.hostName}`}</span>
        ) : null}
      </div>
      {overview?.scanTruncated === true ? (
        <p className="border-b border-border bg-amber-500/10 px-3 py-1 text-xs text-amber-600">
          Repository scan hit a safety limit; deeper folders were skipped.
        </p>
      ) : null}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{listBody}</div>
        {selectedHash !== null ? (
          <aside
            className="absolute inset-y-0 right-0 z-10 w-full max-w-md border-l border-border bg-background shadow-lg md:static md:z-auto md:w-[26rem] md:shrink-0 md:max-w-none md:shadow-none"
            aria-label="Commit details"
          >
            {selectedHash === UNCOMMITTED_CHANGES_KEY ? (
              <UncommittedCard
                status={status}
                onClose={() => setSelectedHash(null)}
              />
            ) : detailLoading && detail === null ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : detail !== null ? (
              <CommitDetail
                detail={detail}
                onClose={() => setSelectedHash(null)}
                onNavigateParent={(hash) => setSelectedHash(hash)}
                onOpenFile={handleOpenFile}
                openFilePath={openFilePath}
                patch={patch}
                patchLoading={patchLoading}
                patchError={patchError}
                onCopyHash={handleCopyHash}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "project-origin",
    mount({ signal }) {
      const stopTracking = trackLastProjectRoute((projectId) => {
        writeLastProjectRoute(projectId);
      });
      signal.addEventListener("abort", stopTracking, { once: true });
      return () => {
        signal.removeEventListener("abort", stopTracking);
        stopTracking();
      };
    },
  });
  app.slots.navPanel({
    id: "git-graph",
    title: "Git Graph",
    icon: "GitBranch",
    path: "git-graph",
    component: GitGraphPanel,
  });
});
