import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreads,
  type PluginNavPanelProps,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import type { findingsUiRpcContract } from "../rpc.js";
import { FINDING_COLUMNS } from "./columns.js";
import { FilterBar } from "./FilterBar.js";
import { FindingsHeader } from "./FindingsHeader.js";
import { FindingsTable } from "./FindingsTable.js";
import { SavedViews } from "./SavedViews.js";
import { FindingDetailStub } from "./detail/index.js";
import {
  filterSnapshot,
  findingDetailSubPath,
  findingsTableSubPath,
  findingsViewSubPath,
  normalizeFindingsFilter,
  parseFindingsRoute,
  type FindingsFilter,
  type FindingsUiState,
} from "./route.js";
import {
  FindingsEmptyState,
  FindingsErrorState,
  FindingsLoadingState,
  FindingsPageError,
  FindingsStaleBanner,
  FindingsUnconfiguredState,
  FindingsViewNotFound,
} from "./states.js";
import { FindingsTriage, FindingsTriageStub } from "./triage/index.js";
import { useFindings } from "./useFindings.js";
import { useSavedViews } from "./useSavedViews.js";

interface FindingScope {
  platformProjectId: string;
  projectVersionId: string;
}

export function FindingsPanel({
  subPath,
}: PluginNavPanelProps): React.JSX.Element {
  const route = useMemo(() => parseFindingsRoute(subPath), [subPath]);
  const navigate = useBbNavigate();
  const context = useBbContext();
  const sidebar = experimental_useSidebarThreads();
  const rpc = useRpc<typeof findingsUiRpcContract>();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const projectId =
    context.projectId ??
    selectedProjectId ??
    (sidebar.status === "ready" ? (sidebar.projects[0]?.id ?? null) : null);
  const [versions, setVersions] = useState<
    Array<{
      platformProjectId: string;
      projectVersionId: string;
      asOf: string | null;
      state: "fresh" | "stale";
    }>
  >([]);
  const [platformProjectId, setPlatformProjectId] = useState<string | null>(
    null,
  );
  const [projectVersionId, setProjectVersionId] = useState<string | null>(null);
  const selectedVersionRef = useRef<FindingScope | null>(null);
  const [versionLoading, setVersionLoading] = useState(Boolean(projectId));
  const [versionRequest, setVersionRequest] = useState(0);
  const saved = useSavedViews(projectId);
  const activeView =
    route.kind === "view"
      ? saved.views.find((view) => view.id === route.view)
      : undefined;
  const [customColumns, setCustomColumns] = useState<string[]>([
    ...FINDING_COLUMNS,
  ]);
  const columns = activeView?.columns ?? customColumns;
  const filter = useMemo<FindingsFilter>(
    () =>
      route.kind === "view"
        ? normalizeFindingsFilter(activeView?.filter ?? {})
        : route.kind === "table" || route.kind === "finding"
          ? route.filter
          : normalizeFindingsFilter({}),
    [activeView, route],
  );
  const missingView = route.kind === "view" && !saved.loading && !activeView;
  const data = useFindings(
    missingView || (saved.loading && route.kind === "view")
      ? null
      : platformProjectId,
    projectVersionId,
    filter,
  );
  const [dismissedStale, setDismissedStale] = useState<string | null>(null);
  const [ui, setUi] = useState<FindingsUiState>({
    route: {},
    selection: { mode: "explicit", keys: new Set() },
    cursorKey: null,
  });
  const selectVersion = useCallback((next: FindingScope | null) => {
    const current = selectedVersionRef.current;
    if (
      current?.platformProjectId === next?.platformProjectId &&
      current?.projectVersionId === next?.projectVersionId
    ) {
      return;
    }
    selectedVersionRef.current = next;
    setPlatformProjectId(next?.platformProjectId ?? null);
    setProjectVersionId(next?.projectVersionId ?? null);
    setUi((currentUi) => ({
      ...currentUi,
      selection: { mode: "explicit", keys: new Set() },
      cursorKey: null,
    }));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (active && selectedVersionRef.current === null)
          setVersionLoading(true);
        return rpc.call("cachedProjectVersions", { projectId });
      })
      .then((result) => {
        if (!active) return;
        setVersions(result.versions);
        const current = selectedVersionRef.current;
        const preserved = current
          ? result.versions.find(
              (version) =>
                version.platformProjectId === current.platformProjectId &&
                version.projectVersionId === current.projectVersionId,
            )
          : undefined;
        const fallback =
          result.versions.find(
            (version) =>
              version.platformProjectId === result.selectedPlatformProjectId &&
              version.projectVersionId === result.selectedProjectVersionId,
          ) ?? result.versions[0];
        selectVersion(preserved ?? fallback ?? null);
      })
      .catch(() => {
        if (!active) return;
        setVersions([]);
        selectVersion(null);
      })
      .finally(() => {
        if (active) setVersionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, rpc, selectVersion, versionRequest]);

  useRealtime("findings:changed", (payload) => {
    // Every accepted finding publication can introduce a cached scope, so the
    // catalog invalidation is ungated. The picker itself is pinned: the fetch
    // effect preserves its current scope while that scope remains available.
    setVersionRequest((value) => value + 1);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "projectVersionId" in payload &&
      payload.projectVersionId === projectVersionId
    ) {
      void data.retry();
    }
  });

  const changeFilter = useCallback(
    (next: FindingsFilter) => {
      setUi((current) => ({
        ...current,
        selection: { mode: "explicit", keys: new Set() },
      }));
      navigate.toPluginPanel("findings", {
        subPath: findingsTableSubPath(next),
      });
    },
    [navigate],
  );

  const changeSelection = useCallback(
    (
      key: string,
      isSelected: boolean,
      shift: boolean,
      anchorKey: string | null,
    ) => {
      setUi((current) => {
        if (current.selection.mode === "predicate") {
          const excluded = new Set(current.selection.excluded);
          if (isSelected) excluded.delete(key);
          else excluded.add(key);
          return { ...current, selection: { ...current.selection, excluded } };
        }
        const keys = new Set(current.selection.keys);
        if (shift && anchorKey) {
          const start = data.rows.findIndex(
            (row) => row.stableKey === anchorKey,
          );
          const end = data.rows.findIndex((row) => row.stableKey === key);
          if (start >= 0 && end >= 0) {
            for (
              let index = Math.min(start, end);
              index <= Math.max(start, end);
              index += 1
            ) {
              const row = data.rows[index];
              if (!row) continue;
              if (isSelected) keys.add(row.stableKey);
              else keys.delete(row.stableKey);
            }
          }
        } else if (isSelected) keys.add(key);
        else keys.delete(key);
        return { ...current, selection: { mode: "explicit", keys } };
      });
    },
    [data.rows],
  );

  const selectPage = useCallback(() => {
    const page = data.rows.slice(-100);
    setUi((current) => {
      if (current.selection.mode === "predicate") {
        const excluded = new Set(current.selection.excluded);
        for (const row of page) excluded.delete(row.stableKey);
        return { ...current, selection: { ...current.selection, excluded } };
      }
      const keys = new Set(current.selection.keys);
      for (const row of page) keys.add(row.stableKey);
      return { ...current, selection: { mode: "explicit", keys } };
    });
  }, [data.rows]);

  if (route.kind === "policy" || route.kind === "import") {
    return (
      <section
        aria-label="Findings"
        className="h-full min-h-0 bg-background text-foreground"
      >
        <FindingsTriageStub kind={route.kind} />
      </section>
    );
  }

  const hasFilters = Object.keys(filterSnapshot(filter)).length > 0;
  const staleMessage =
    data.cache?.state === "stale"
      ? (data.cache.message ?? "The last cache refresh failed.")
      : null;
  const showStale = staleMessage && dismissedStale !== staleMessage;
  return (
    <section
      aria-label="Findings"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <FindingsHeader
        loaded={data.rows.length}
        onClearSelection={() =>
          setUi((current) => ({
            ...current,
            selection: { mode: "explicit", keys: new Set() },
          }))
        }
        onProject={(id) => {
          setSelectedProjectId(id || null);
          setVersions([]);
          selectVersion(null);
          setVersionLoading(Boolean(id));
        }}
        onSelectPage={selectPage}
        onSelectPredicate={() =>
          setUi((current) => ({
            ...current,
            selection: {
              mode: "predicate",
              filter: filterSnapshot(filter),
              excluded: new Set(),
              total: data.total,
            },
          }))
        }
        onVersion={(platformId, versionId) => {
          selectVersion(
            platformId && versionId
              ? {
                  platformProjectId: platformId,
                  projectVersionId: versionId,
                }
              : null,
          );
        }}
        platformProjectId={platformProjectId}
        projectId={projectId}
        projectVersionId={projectVersionId}
        projects={sidebar.projects}
        selection={ui.selection}
        total={data.total}
        versions={versions}
      />
      <SavedViews
        activeId={route.kind === "view" ? route.view : undefined}
        columns={columns}
        error={saved.error}
        filter={filter}
        loading={saved.loading}
        onColumns={(next) => {
          setCustomColumns(next);
          if (route.kind === "view")
            navigate.toPluginPanel("findings", {
              subPath: findingsTableSubPath(filter),
            });
        }}
        onCreate={async (name, currentFilter, currentColumns) => {
          const view = await saved.create(name, currentFilter, currentColumns);
          if (view)
            navigate.toPluginPanel("findings", {
              subPath: findingsViewSubPath(view.id),
            });
        }}
        onDelete={async (id) => {
          await saved.remove(id);
          navigate.toPluginPanel("findings", { subPath: "", replace: true });
        }}
        onOpen={(id) =>
          navigate.toPluginPanel("findings", {
            subPath: findingsViewSubPath(id),
          })
        }
        onRename={saved.rename}
        recoveredFromCorrupt={saved.recoveredFromCorrupt}
        views={saved.views}
      />
      <FilterBar
        onChange={changeFilter}
        onClear={() => changeFilter({})}
        value={filter}
      />
      {showStale ? (
        <FindingsStaleBanner
          message={staleMessage}
          onDismiss={() => setDismissedStale(staleMessage)}
          onRetry={() => void data.retry()}
        />
      ) : null}
      <FindingsTriage
        active={
          route.kind === "table" ||
          route.kind === "finding" ||
          route.kind === "view"
        }
        cursorKey={ui.cursorKey}
        filter={filterSnapshot(filter)}
        loading={versionLoading || data.loading}
        onCommitted={() => void data.retry()}
        onCursor={(key) => setUi((current) => ({ ...current, cursorKey: key }))}
        onOpen={(key) =>
          navigate.toPluginPanel("findings", {
            subPath: findingDetailSubPath(key, filter),
          })
        }
        onSelection={changeSelection}
        platformProjectId={platformProjectId}
        projectVersionId={projectVersionId}
        rows={data.rows}
        selection={ui.selection}
        total={data.total}
        workspaceProjectId={projectId}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {missingView ? (
            <FindingsViewNotFound
              name={route.kind === "view" ? route.view : ""}
              onReturn={() =>
                navigate.toPluginPanel("findings", {
                  subPath: "",
                  replace: true,
                })
              }
            />
          ) : !projectId ? (
            <FindingsUnconfiguredState detail="Select a bb project to discover its accepted cached finding versions." />
          ) : versionLoading ? (
            <FindingsLoadingState />
          ) : !projectVersionId ? (
            <FindingsUnconfiguredState detail="This project has no accepted findings cache. Pull a project version through Sync first." />
          ) : data.loading && data.rows.length === 0 ? (
            <FindingsLoadingState />
          ) : data.error && data.rows.length === 0 ? (
            <FindingsErrorState
              message={data.error}
              onRetry={() => void data.retry()}
            />
          ) : !data.loading && data.rows.length === 0 ? (
            <FindingsEmptyState
              filtered={hasFilters}
              onClear={() => changeFilter({})}
              onRetry={() => void data.retry()}
            />
          ) : (
            <FindingsTable
              columns={columns}
              cursorKey={ui.cursorKey}
              hasNextPage={Boolean(data.next)}
              loadingMore={data.loadingMore}
              onCursor={(key) =>
                setUi((current) => ({ ...current, cursorKey: key }))
              }
              onNearEnd={() => {
                if (data.next) void data.loadMore();
              }}
              onOpen={(key) =>
                navigate.toPluginPanel("findings", {
                  subPath: findingDetailSubPath(key, filter),
                })
              }
              onSelection={changeSelection}
              rows={data.rows}
              selection={ui.selection}
              total={data.total}
            />
          )}
          {data.pageError ? (
            <FindingsPageError
              loading={data.loadingMore}
              message={data.pageError}
              onRetry={() => void data.loadMore()}
            />
          ) : null}
        </div>
        {route.kind === "finding" ? (
          <FindingDetailStub
            onClose={() =>
              navigate.toPluginPanel("findings", {
                subPath: findingsTableSubPath(filter),
              })
            }
            stableKey={route.stableKey}
          />
        ) : null}
      </div>
    </section>
  );
}
