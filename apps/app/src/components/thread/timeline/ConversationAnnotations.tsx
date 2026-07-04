import type { TimelineConversationAnnotation } from "@bb/server-contract";
import { Icon } from "@/components/ui/icon.js";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import type { ThreadTimelineLocalFileLinkHandler } from "./types.js";

function annotationLocationLabel(
  annotation: TimelineConversationAnnotation,
): string {
  const fileName = annotation.path.split("/").pop() || annotation.path;
  const range =
    annotation.startLine === annotation.endLine
      ? `${annotation.startLine}`
      : `${annotation.startLine}-${annotation.endLine}`;
  return `${fileName}:${range}`;
}

interface ConversationAnnotationsProps {
  annotations: readonly TimelineConversationAnnotation[];
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  workspaceRootPath?: string;
}

export function ConversationAnnotations({
  annotations,
  onOpenLocalFileLink,
  workspaceRootPath,
}: ConversationAnnotationsProps) {
  if (annotations.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
      {annotations.map((annotation, index) => {
        const comment = annotation.comment.trim();
        const location = annotationLocationLabel(annotation);
        const linkPath = resolveAbsoluteFilePath({
          path: annotation.path,
          rootPath: workspaceRootPath ?? null,
        });
        const openAnnotation = () => {
          if (linkPath === null) {
            return;
          }
          onOpenLocalFileLink?.({
            path: linkPath,
            lineRange: {
              startLineNumber: annotation.startLine,
              endLineNumber: annotation.endLine,
            },
          });
        };
        const disabled = onOpenLocalFileLink === undefined || linkPath === null;
        return (
          <button
            type="button"
            key={`${annotation.path}-${annotation.startLine}-${index}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-recessed px-2 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
            title={comment.length > 0 ? `${location} — ${comment}` : location}
            disabled={disabled}
            onClick={openAnnotation}
          >
            <Icon name="MessageSquare" className="size-3 shrink-0" />
            <span className="shrink-0 font-medium text-foreground">
              {location}
            </span>
            {comment.length > 0 ? (
              <span className="truncate">{comment}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
