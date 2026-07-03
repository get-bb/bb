import type { TimelineConversationAnnotation } from "@bb/server-contract";
import { Icon } from "@/components/ui/icon.js";

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
}

export function ConversationAnnotations({
  annotations,
}: ConversationAnnotationsProps) {
  if (annotations.length === 0) {
    return null;
  }

  return (
    <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
      {annotations.map((annotation, index) => {
        const comment = annotation.comment.trim();
        const location = annotationLocationLabel(annotation);
        return (
          <span
            key={`${annotation.path}-${annotation.startLine}-${index}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-xs text-muted-foreground"
            title={comment.length > 0 ? `${location} — ${comment}` : location}
          >
            <Icon name="MessageSquare" className="size-3 shrink-0" />
            <span className="shrink-0 font-medium text-foreground">
              {location}
            </span>
            {comment.length > 0 ? (
              <span className="truncate">{comment}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
