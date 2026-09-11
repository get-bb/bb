import { useMemo } from "react";
import { useStore } from "jotai";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_ROW_HEIGHT_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useDrafts } from "@/hooks/queries/draft-queries";
import { useRecoverableDrafts } from "@/hooks/useDraftResource";
import { getDraftRoutePath, parseDraftRouteId } from "@/lib/draft-route";
import {
  getDraftDisplayTitle,
  mergeDraftListEntries,
  type DraftListEntry,
} from "@/lib/drafts/draft-list";
import { openDraftInSplit } from "@/lib/split-layout/openDraftInSplit";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import { usePaneContentSplitIndicator } from "./paneContentSplitIndicator";
import { SplitPaneMiniMap } from "./SplitPaneMiniMap";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";

function DraftRow({
  draft,
  projectName,
  projectUnavailable,
  isSelected,
  onNavigate,
}: {
  draft: DraftListEntry;
  projectName: string;
  projectUnavailable: boolean;
  isSelected: boolean;
  onNavigate?: () => void;
}) {
  const title = getDraftDisplayTitle(draft);
  const store = useStore();
  const navigate = useNavigate();
  const isCompact = useIsCompactViewport();
  const content = { kind: "new-thread", draftId: draft.id } as const;
  const split = usePaneContentSplitDrag({
    content,
    enabled: true,
    label: title,
    onNavigate,
  });
  const splitIndicator = usePaneContentSplitIndicator(content, true);
  const recoveryLabel =
    draft.recoveryStatus === "deleted"
      ? "Recovery available"
      : draft.recoveryStatus === "conflict"
        ? "Conflicting changes"
        : draft.recoveryStatus === "error"
          ? "Not saved"
          : projectUnavailable
            ? "Project unavailable"
            : null;

  return (
    <Link
      to={getDraftRoutePath(draft.id)}
      aria-current={isSelected ? "page" : undefined}
      aria-label={`${title}, draft, ${projectName}${recoveryLabel ? `, ${recoveryLabel}` : ""}`}
      title={`${title} — ${projectName}${recoveryLabel ? ` — ${recoveryLabel}` : ""}`}
      data-sidebar-draft-id={draft.id}
      onPointerDown={split.onPointerDown}
      onClick={(event) => {
        if (event.button !== 0 || event.altKey || event.shiftKey) return;
        event.preventDefault();
        openDraftInSplit({
          store,
          navigate,
          draftId: draft.id,
          isCompact,
          split: event.metaKey || event.ctrlKey ? "right" : "replace",
        });
        onNavigate?.();
      }}
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        COARSE_POINTER_ROW_HEIGHT_CLASS,
        isSelected
          ? SIDEBAR_ROW_SELECTED_STATE_CLASS
          : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
        !isSelected &&
          splitIndicator.isOpenInSplit &&
          SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS,
        "pr-2 outline-none ring-sidebar-ring focus-visible:ring-2",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {recoveryLabel ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {recoveryLabel}
        </span>
      ) : splitIndicator.miniMap ? (
        <SplitPaneMiniMap
          slots={splitIndicator.miniMap}
          label={`${title} — open in split`}
        />
      ) : (
        <Icon
          name="Edit"
          className="size-3.5 shrink-0 text-subtle-foreground"
        />
      )}
    </Link>
  );
}

export function DraftRows({
  projects,
  onNavigate,
}: {
  projects: readonly ProjectResponse[];
  onNavigate?: () => void;
}) {
  const query = useDrafts();
  const localDrafts = useRecoverableDrafts();
  const location = useLocation();
  const selectedDraftId =
    location.pathname === "/" ? parseDraftRouteId(location.search) : null;
  const drafts = useMemo(
    () =>
      mergeDraftListEntries(
        query.data?.pages.flatMap((page) => page.drafts) ?? [],
        localDrafts,
      ),
    [localDrafts, query.data],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  return (
    <TopLevelSidebarSection label="Drafts" sectionId="drafts">
      {drafts.map((draft) => {
        const projectId = draft.content.projectId;
        const projectName =
          projectId === PERSONAL_PROJECT_ID
            ? "Personal"
            : projectId === null
              ? "No project selected"
              : (projectNames.get(projectId) ?? "Project unavailable");
        return (
          <DraftRow
            key={draft.id}
            draft={draft}
            projectName={projectName}
            projectUnavailable={
              projectId !== null &&
              projectId !== PERSONAL_PROJECT_ID &&
              !projectNames.has(projectId)
            }
            isSelected={selectedDraftId === draft.id}
            onNavigate={onNavigate}
          />
        );
      })}
      {query.isPending && drafts.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Loading drafts…
        </p>
      ) : null}
      {query.isError ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          <span>Saved drafts could not load.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {!query.isPending && !query.isError && drafts.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Add a message or attachment to a new thread to keep a draft here.
        </p>
      ) : null}
      {query.hasNextPage ? (
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start px-2 text-xs font-normal text-muted-foreground"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more drafts"}
        </Button>
      ) : null}
    </TopLevelSidebarSection>
  );
}
