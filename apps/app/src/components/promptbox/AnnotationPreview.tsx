import { Icon } from "@/components/ui/icon.js";
import type { PromptDraftAnnotation } from "@/lib/prompt-draft";

function annotationLocationLabel(annotation: PromptDraftAnnotation): string {
  const fileName = annotation.path.split("/").pop() || annotation.path;
  const range =
    annotation.startLine === annotation.endLine
      ? `${annotation.startLine}`
      : `${annotation.startLine}-${annotation.endLine}`;
  return `${fileName}:${range}`;
}

interface AnnotationPreviewProps {
  annotations: PromptDraftAnnotation[];
  onRemoveAnnotation?: (id: string) => void;
}

export function AnnotationPreview({
  annotations,
  onRemoveAnnotation,
}: AnnotationPreviewProps) {
  if (annotations.length === 0) {
    return null;
  }

  return (
    <div className="mx-3 mb-1 mt-1 flex flex-wrap gap-1.5">
      {annotations.map((annotation) => {
        const comment = annotation.comment.trim();
        const location = annotationLocationLabel(annotation);
        return (
          <span
            key={annotation.id}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-recessed px-2 py-0.5 text-xs text-muted-foreground"
            title={comment.length > 0 ? `${location} — ${comment}` : location}
          >
            <Icon name="MessageSquare" className="size-3 shrink-0" />
            <span className="shrink-0 font-medium text-foreground">
              {location}
            </span>
            {comment.length > 0 ? (
              <span className="truncate">{comment}</span>
            ) : null}
            {onRemoveAnnotation ? (
              <button
                type="button"
                onClick={() => onRemoveAnnotation(annotation.id)}
                className="rounded p-0.5 hover:bg-state-hover"
                title={`Remove comment on ${location}`}
              >
                <Icon name="X" className="size-3" />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
