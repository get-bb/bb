import { useEffect, useMemo, useState } from "react";
import type { TimelineFeedDetailPart } from "@bb/server-contract";
import {
  assertNever,
  fileNameFromPath,
  getTimelineFeedDetail,
  hasTimelineFeedDetailPart,
  type TimelineImageViewViewWorkRow,
  type TimelineViewWorkflowWorkRow,
  type TimelineViewWorkRow,
} from "@bb/thread-view";
import { EventCodeBlock } from "../../ui/event-code-block.js";
import { ImageLightbox } from "../../ui/image-lightbox.js";
import { EmptyStatePanel } from "../../ui/empty-state.js";
import { TerminalOutputBlock } from "./TerminalOutputBlock.js";
import { TimelineDetailScroll } from "./TimelineDetailScroll.js";
import { TimelineFileDiffBlock } from "./TimelineFileDiffBlock.js";
import { ToolCallDetailBlock } from "./ToolCallDetailBlock.js";
import { QuestionWorkRowBody } from "./QuestionWorkRowBody.js";
import { WorkflowWorkRowBody } from "./WorkflowWorkRowBody.js";
import {
  useThreadTimelineRowDetail,
  useThreadTimelineWorkOutputDetail,
} from "@/hooks/queries/thread-queries";
import { buildThreadHostFileContentUrl } from "@/lib/file-content-urls";
import type { ThreadTimelineTheme } from "./types.js";
import type { ThreadTimelineImageViewSrcResolver } from "./types.js";

export interface WorkRowBodyProps {
  resolveImageViewSrc?: ThreadTimelineImageViewSrcResolver;
  row: TimelineViewWorkRow;
  themeType: ThreadTimelineTheme;
  workspaceRootPath: string | undefined;
}

type DetailLine = string | null;

interface ImageViewWorkRowBodyProps {
  resolveImageViewSrc?: ThreadTimelineImageViewSrcResolver;
  row: TimelineImageViewViewWorkRow;
}

interface ResolveImageViewSourceArgs {
  resolveImageViewSrc: ThreadTimelineImageViewSrcResolver | undefined;
  row: TimelineImageViewViewWorkRow;
}

type TimelineOutputWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "command" | "tool" }
>;

interface CommandWorkRowBodyProps {
  row: Extract<TimelineOutputWorkRow, { workKind: "command" }>;
}

interface ToolWorkRowBodyProps {
  row: Extract<TimelineOutputWorkRow, { workKind: "tool" }>;
}

interface FileChangeWorkRowBodyProps {
  row: Extract<TimelineViewWorkRow, { workKind: "file-change" }>;
  themeType: ThreadTimelineTheme;
  workspaceRootPath: string | undefined;
}

interface TimelineFeedRowDetailQueryArgs {
  parts: readonly TimelineFeedDetailPart[];
  row: TimelineViewWorkRow;
}

interface WorkflowHydratedWorkRowBodyProps {
  row: TimelineViewWorkflowWorkRow;
}

function compactDetailLines(lines: readonly DetailLine[]): string[] {
  const compactedLines: string[] = [];
  for (const line of lines) {
    if (line !== null) {
      compactedLines.push(line);
    }
  }
  return compactedLines;
}

function useTimelineWorkOutput(row: TimelineOutputWorkRow): string {
  const outputDetailQuery = useThreadTimelineWorkOutputDetail(
    {
      callId: row.callId,
      sourceSeqEnd: row.sourceSeqEnd,
      sourceSeqStart: row.sourceSeqStart,
      threadId: row.threadId,
      workKind: row.workKind,
    },
    {
      enabled: row.outputDetail !== undefined,
    },
  );
  return outputDetailQuery.data?.output ?? row.output;
}

function useTimelineFeedRowDetail({
  parts,
  row,
}: TimelineFeedRowDetailQueryArgs) {
  return useThreadTimelineRowDetail({
    detail: getTimelineFeedDetail(row),
    parts,
    threadId: row.threadId,
  });
}

function CommandWorkRowBody({ row }: CommandWorkRowBodyProps) {
  const output = useTimelineWorkOutput(row);
  return (
    <TerminalOutputBlock
      commandLine={`$ ${row.command}`}
      metadataLines={compactDetailLines([
        row.source ? `source: ${row.source}` : null,
      ])}
      output={output}
      exitCode={row.exitCode}
      streaming={row.status === "pending"}
    />
  );
}

function ToolWorkRowBody({ row }: ToolWorkRowBodyProps) {
  const output = useTimelineWorkOutput(row);
  return (
    <ToolCallDetailBlock
      toolName={row.toolName}
      args={row.toolArgs}
      output={output}
      streaming={row.status === "pending"}
    />
  );
}

function FileChangeWorkRowBody({
  row,
  themeType,
  workspaceRootPath,
}: FileChangeWorkRowBodyProps) {
  const detailQuery = useTimelineFeedRowDetail({
    row,
    parts: ["file-diff", "stderr", "stdout"],
  });
  const hasPendingDiff =
    row.change.diff === null &&
    hasTimelineFeedDetailPart(row, "file-diff") &&
    !detailQuery.data &&
    !detailQuery.isError;
  const diff = detailQuery.data
    ? detailQuery.data.parts.fileDiff
    : row.change.diff;
  const stderr = detailQuery.data ? detailQuery.data.parts.stderr : row.stderr;
  const change = useMemo(
    () => ({
      ...row.change,
      diff,
    }),
    [diff, row.change],
  );

  if (hasPendingDiff) {
    return (
      <div className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-xs text-muted-foreground">
        Loading diff...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <TimelineFileDiffBlock
        change={change}
        themeType={themeType}
        workspaceRootPath={workspaceRootPath}
      />
      {stderr ? (
        <TimelineDetailScroll
          size="base"
          contentKey={stderr}
          className="rounded-md"
        >
          <EventCodeBlock
            tone="danger"
            className="rounded-none border-0 px-2 py-1.5"
          >
            {stderr}
          </EventCodeBlock>
        </TimelineDetailScroll>
      ) : null}
    </div>
  );
}

function WorkflowHydratedWorkRowBody({
  row,
}: WorkflowHydratedWorkRowBodyProps) {
  const detailQuery = useTimelineFeedRowDetail({
    row,
    parts: ["workflow"],
  });
  const workflow = detailQuery.data
    ? detailQuery.data.parts.workflow
    : row.workflow;
  const hydratedRow = useMemo(
    () => ({
      ...row,
      workflow,
    }),
    [row, workflow],
  );

  if (
    row.workflow === null &&
    hasTimelineFeedDetailPart(row, "workflow") &&
    !detailQuery.data &&
    !detailQuery.isError
  ) {
    return (
      <div className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-xs text-muted-foreground">
        Loading workflow details...
      </div>
    );
  }

  return <WorkflowWorkRowBody row={hydratedRow} />;
}

function resolveImageViewSource({
  resolveImageViewSrc,
  row,
}: ResolveImageViewSourceArgs): string {
  return resolveImageViewSrc
    ? resolveImageViewSrc({ path: row.path, threadId: row.threadId })
    : buildThreadHostFileContentUrl(row.threadId, row.path);
}

function ImageViewWorkRowBody({
  resolveImageViewSrc,
  row,
}: ImageViewWorkRowBodyProps) {
  const [loadError, setLoadError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imageSrc = resolveImageViewSource({ resolveImageViewSrc, row });
  const imageName = fileNameFromPath(row.path);
  const imageAlt = `Viewed image: ${imageName}`;

  useEffect(() => {
    setLoadError(false);
    setLightboxOpen(false);
  }, [imageSrc, row.completedAt, row.status]);

  if (loadError) {
    return (
      <EmptyStatePanel className="rounded-lg">
        <div>Image preview unavailable.</div>
        <div className="mt-1 break-all font-mono text-xs">{row.path}</div>
      </EmptyStatePanel>
    );
  }

  return (
    <>
      <button
        type="button"
        className="block w-full max-w-80 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-96"
        onClick={() => setLightboxOpen(true)}
        aria-label={`Open image preview: ${imageName}`}
        title={row.path}
      >
        <img
          src={imageSrc}
          alt=""
          className="block h-auto w-full object-contain"
          loading="lazy"
          decoding="async"
          onError={() => setLoadError(true)}
        />
      </button>
      <ImageLightbox
        imageAlt={imageAlt}
        imageSrc={lightboxOpen ? imageSrc : null}
        onClose={() => setLightboxOpen(false)}
        title={imageAlt}
      />
    </>
  );
}

export function WorkRowBody({
  resolveImageViewSrc,
  row,
  themeType,
  workspaceRootPath,
}: WorkRowBodyProps) {
  switch (row.workKind) {
    case "command":
      return <CommandWorkRowBody row={row} />;
    case "tool":
      return <ToolWorkRowBody row={row} />;
    case "file-change":
      return (
        <FileChangeWorkRowBody
          row={row}
          themeType={themeType}
          workspaceRootPath={workspaceRootPath}
        />
      );
    case "delegation":
      // Delegation expanded bodies are dispatched by `TimelineExpandableBody`
      // (in `ThreadTimelineRows.tsx`), which wraps childRows + output text in
      // a delegation-tier scroll container. This branch is unreachable for
      // the App renderer; kept exhaustive for the type.
      return null;
    case "question":
      return <QuestionWorkRowBody row={row} />;
    case "workflow":
      return <WorkflowHydratedWorkRowBody row={row} />;
    case "image-view":
      return (
        <ImageViewWorkRowBody
          row={row}
          resolveImageViewSrc={resolveImageViewSrc}
        />
      );
    case "approval":
    case "web-search":
    case "web-fetch":
      return null;
    default:
      return assertNever(row);
  }
}
