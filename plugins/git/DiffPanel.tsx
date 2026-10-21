import { appendQuoteToDraftText } from "@bb/client-core";
import { openChangedFile } from "./open-changed-file.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useResizeObserver } from "usehooks-ts";
import {
  experimental_useAppPanel,
  experimental_useFixedTabTarget,
  experimental_useRpcQuery,
  useBbNavigate,
  useComposers,
} from "@get-bb/plugin-sdk/app";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { DetailCard } from "@bb/shared-ui/detail-card";
import { DiffLoadingSkeleton } from "@bb/shared-ui/code-loading-skeletons";
import { useThreadGitStatus } from "./read-hooks.js";
import { gitRpcContract } from "./contract.js";
import { gitDiffTab } from "./tab-reference.js";
import { GitDiffToolbar } from "./GitDiffToolbar.js";
import { BranchRow, MergeBaseRow, GitStatusRow } from "./MetadataRows.js";
import { CommitsSection } from "./CommitsSection.js";
import { UncommittedChangesSection } from "./ChangesSection.js";
import { DiffFilesPanel } from "./DiffFilesPanel.js";
import {
  buildGitDiffIdentity,
  buildGitDiffTarget,
  buildGitDiffSelectionOptions,
  shouldResetSelectedGitDiffSelection,
} from "./gitDiffPanelHelpers.js";
import {
  DEFAULT_DIFF_FILE_FILTERS,
  filterDiffFiles,
  diffExtensionCounts,
} from "./diff-file-filters.js";
import {
  summarizeDiffFileEntries,
  useDiffFilesCollapseControls,
} from "./diffFilesStore.js";
import { useEnvironmentDiffViewed } from "./viewed-hooks.js";
import { useMergeBase } from "./merge-base.js";
import { useDiffFileContents } from "./file-contents.js";
import {
  useGitDiffDisplayModePreference,
  useGitDiffIgnoreWhitespacePreference,
  useGitDiffLineOverflowModePreference,
} from "./view-preferences.js";

export function useDiffVisible({ threadId }: { threadId: string }) {
  const { context, environment } = useThreadGitStatus(threadId);
  return (
    context.data === undefined ||
    (environment !== null &&
      environment !== undefined &&
      environment.isGitRepo &&
      !(context.data.archivedAt !== null && !environment.managed))
  );
}

export function DiffPanel({ threadId }: { threadId: string }) {
  const data = useThreadGitStatus(threadId);
  const mergeBase = useMergeBase(data.environment, data.workspace);
  const navigate = useBbNavigate();
  const panel = experimental_useAppPanel();
  const composers = useComposers();
  const intent = experimental_useFixedTabTarget(gitDiffTab);
  const [selection, setSelection] = useState<string | null>(null);
  const [scrollPath, setScrollPath] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState<string | null>(null);
  const [filters, setFilters] = useState(DEFAULT_DIFF_FILE_FILTERS);
  const [ignoreWhitespace, setIgnoreWhitespace] =
    useGitDiffIgnoreWhitespacePreference();
  const [overflow, setOverflow] = useGitDiffLineOverflowModePreference();
  const [displayPreference, setDisplayPreference] =
    useGitDiffDisplayModePreference();
  const [compactDisplay, setCompactDisplay] = useState<"unified" | "split">(
    "unified",
  );
  const compact = useIsCompactViewport();
  const root = useRef<HTMLDivElement>(null!);
  const { width } = useResizeObserver({ ref: root, box: "border-box" });
  const display = compact
    ? compactDisplay
    : (displayPreference ?? ((width ?? 0) >= 760 ? "split" : "unified"));
  const target = useMemo(
    () => buildGitDiffTarget(selection, mergeBase.selectedMergeBaseBranch),
    [selection, mergeBase.selectedMergeBaseBranch],
  );
  const query = experimental_useRpcQuery({
    contract: gitRpcContract,
    method: "files",
    input: {
      environmentId: data.environment?.id ?? "",
      target: target ?? { type: "uncommitted" },
      ignoreWhitespace,
    },
    enabled: data.environment?.status === "ready" && target !== undefined,
  });
  const available =
    query.data?.outcome === "available" ? query.data : undefined;
  const [previous, setPrevious] = useState<{
    environmentId: string;
    target: NonNullable<typeof target>;
    result: NonNullable<typeof available>;
  } | null>(null);
  useEffect(() => {
    if (available && target && data.environment)
      setPrevious({
        environmentId: data.environment.id,
        target,
        result: available,
      });
  }, [available, target, data.environment]);
  const retained =
    !available &&
    query.isFetching &&
    previous?.environmentId === data.environment?.id
      ? previous
      : null;
  const result = available ?? retained?.result;
  const displayedTarget = retained?.target ?? target;
  const isPlaceholderData = retained !== null;
  const isLoading = query.isLoading && !isPlaceholderData;
  const files = result?.files ?? EMPTY_FILES;
  const identity = buildGitDiffIdentity({
    environmentId: data.environment?.id,
    target: displayedTarget,
    mergeBaseRef: result?.mergeBaseRef ?? null,
  });
  const viewed = useEnvironmentDiffViewed(data.environment?.id ?? "", {
    target: displayedTarget,
    enabled: !isPlaceholderData,
    paths: files.map((file) => file.path),
  });
  const revisions = useMemo(
    () => new Map(viewed.data?.files.map((file) => [file.path, file.revision])),
    [viewed.data],
  );
  const filtered = useMemo(
    () => filterDiffFiles(files, fileFilter ?? "", filters, revisions),
    [files, fileFilter, filters, revisions],
  );
  const collapse = useDiffFilesCollapseControls(
    identity,
    filtered,
    files.length,
  );
  const requestContents = useDiffFileContents(
    data.environment,
    displayedTarget,
    result?.mergeBaseRef ?? null,
  );
  const commits = data.workspace?.mergeBase?.commits ?? EMPTY_COMMITS;
  const hasUncommittedChanges =
    (data.workspace?.workingTree.fileCount ?? 0) > 0;
  const options = useMemo(
    () => buildGitDiffSelectionOptions(commits, { hasUncommittedChanges }),
    [commits, hasUncommittedChanges],
  );
  useEffect(() => {
    setSelection(null);
    setFileFilter(null);
    setScrollPath(null);
  }, [data.environment?.id, threadId]);
  useEffect(() => {
    if (!intent?.target) return;
    setFileFilter(null);
    setFilters(DEFAULT_DIFF_FILE_FILTERS);
    if (intent.target.kind === "commit") setSelection(intent.target.sha);
    else {
      setSelection(null);
      setScrollPath(intent.target.path);
    }
    intent.clear();
  }, [intent]);
  useEffect(() => {
    if (
      data.status.data &&
      shouldResetSelectedGitDiffSelection(selection, commits, {
        hasUncommittedChanges,
      })
    )
      setSelection(null);
  }, [selection, commits, hasUncommittedChanges, data.status.data]);
  function openFile(path: string, external: boolean) {
    if (!data.environment) return;
    const options = {
      target: {
        kind: "workspace" as const,
        environmentId: data.environment.id,
        path,
      },
      location: null,
    };
    if (external) navigate.experimental_openFileExternally(options);
    else navigate.experimental_openFilePreview(options);
  }
  if (data.context.data === undefined)
    return (
      <div className="p-4">
        {data.context.error ? (
          <EmptyStatePanel>
            {data.context.error.message}
            <button
              type="button"
              onClick={() => {
                void data.context.refetch();
              }}
            >
              Retry
            </button>
          </EmptyStatePanel>
        ) : (
          <div role="status" aria-label="Loading diff">
            <DiffLoadingSkeleton />
          </div>
        )}
      </div>
    );
  return (
    <div ref={root} className="flex h-full min-h-0 flex-col bg-sidebar">
      <GitDiffToolbar
        selectionValue={selection ?? "all"}
        selectionOptions={options}
        onSelectionChange={(value) =>
          setSelection(value === "all" ? null : value)
        }
        isSelectorDisabled={isLoading || !target}
        stats={summarizeDiffFileEntries(filtered)}
        isStatsLoading={isLoading || !target}
        totalFilesCount={files.length}
        isTruncated={result?.truncated ?? false}
        fileFilter={fileFilter}
        filters={filters}
        onFiltersChange={setFilters}
        extensionCounts={diffExtensionCounts(files)}
        onFileFilterChange={setFileFilter}
        areAllFilesCollapsed={collapse.areAllCollapsed}
        isCollapseAllDisabled={!collapse.hasFiles || isLoading}
        collapseAllDisabledReason={
          isLoading
            ? null
            : files.length === 0
              ? "No changes"
              : !collapse.hasFiles
                ? "No files match filter"
                : null
        }
        onToggleAllCollapsed={collapse.toggleAllCollapsed}
        displayMode={display}
        onDisplayModeChange={compact ? setCompactDisplay : setDisplayPreference}
        lineOverflowMode={overflow}
        onLineOverflowModeChange={setOverflow}
        ignoreWhitespace={ignoreWhitespace}
        onIgnoreWhitespaceChange={setIgnoreWhitespace}
      />
      <div className="max-h-[40%] shrink-0 overflow-y-auto px-4 pb-3">
        <DetailCard>
          <BranchRow workspaceStatus={data.workspace} />
          <MergeBaseRow workspaceStatus={data.workspace} {...mergeBase} />
          <GitStatusRow
            thread={{ archivedAt: data.context.data?.archivedAt ?? null }}
            environment={data.environment ?? null}
            workspaceStatus={data.workspace}
            workspaceStatusError={data.status.error}
            workspaceUnavailable={data.workspaceUnavailable}
          />
        </DetailCard>
        <CommitsSection
          workspaceStatus={data.workspace}
          onCommitClick={setSelection}
          onChangedFileClick={(selection) => {
            if (data.environment)
              openChangedFile(selection, data.environment.id, navigate, panel);
          }}
          onOpenChangedFile={(path) => openFile(path, false)}
        />
        <UncommittedChangesSection
          workspaceStatus={data.workspace}
          onChangedFileClick={(selection) => {
            if (data.environment)
              openChangedFile(selection, data.environment.id, navigate, panel);
          }}
          onOpenChangedFile={(path) => openFile(path, false)}
        />
      </div>
      {result?.truncated ? (
        <div
          role="status"
          className="mx-4 mb-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground"
        >
          Showing the first {files.length} changed files. Additional changes are
          omitted.
        </div>
      ) : null}
      {isLoading ? (
        <div className="px-4" role="status" aria-label="Loading diff">
          <DiffLoadingSkeleton />
        </div>
      ) : result && files.length > 0 && displayedTarget && data.environment ? (
        <DiffFilesPanel
          key={identity}
          isPlaceholderData={isPlaceholderData}
          environmentId={data.environment.id}
          target={displayedTarget}
          diffIdentity={identity}
          files={files}
          fileFilter={fileFilter ?? ""}
          filters={filters}
          initialPatches={result.initialPatches}
          presentation={{ view: display, overflow, showLineNumbers: true }}
          ignoreWhitespace={ignoreWhitespace}
          filePathRoot={data.environment.path}
          isPanelOpen
          scrollToPath={scrollPath}
          onScrolledToPath={() => setScrollPath(null)}
          onOpenFileInEditor={
            navigate.experimental_canOpenFileExternally?.({
              target: {
                kind: "workspace",
                environmentId: data.environment.id,
                path: files[0]?.path ?? "",
              },
              location: null,
            })
              ? (path) => openFile(path, true)
              : undefined
          }
          onOpenFilePreview={(path) => openFile(path, false)}
          onRequestFileContents={requestContents}
          onSelectionAddToChat={(text) => {
            const composer = composers.find(
              (composer) =>
                composer.scope.kind === "thread" &&
                composer.scope.threadId === threadId,
            );
            if (composer) {
              composer.replace((draft) => appendQuoteToDraftText(draft, text));
              composer.focus();
            }
          }}
        />
      ) : (
        <div className="px-4">
          {query.error ||
          (query.data?.outcome === "unavailable" &&
            "error" in query.data.failure) ? (
            <div className="rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive">
              <p>
                {query.error?.message ??
                  (query.data?.outcome === "unavailable"
                    ? query.data.failure.message
                    : "Failed to load git diff")}
              </p>
            </div>
          ) : query.data?.outcome === "unavailable" ? (
            <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                Workspace unavailable
              </p>
              <p className="mt-1 leading-5">{query.data.failure.message}</p>
            </div>
          ) : query.data?.outcome === "not_applicable" ? (
            <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
              <p className="mt-1 leading-5">{query.data.message}</p>
            </div>
          ) : (
            <EmptyStatePanel className="rounded-lg">
              No diff to display.
            </EmptyStatePanel>
          )}
        </div>
      )}
    </div>
  );
}

const EMPTY_FILES: import("./read-contract.js").DiffFileEntry[] = [];
const EMPTY_COMMITS: import("bb-git-contract").WorkspaceCommitSummary[] = [];
