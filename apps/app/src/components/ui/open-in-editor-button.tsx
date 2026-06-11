import { Icon } from "@/components/ui/icon.js";

interface OpenInEditorButtonProps {
  onClick: () => void;
  /** aria-label; defaults to "Open in editor". */
  label?: string;
}

/** Muted icon button that opens the associated file in the user's editor. */
export function OpenInEditorButton({
  onClick,
  label = "Open in editor",
}: OpenInEditorButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title="Open in editor"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon name="ExternalLink" aria-hidden className="size-3" />
    </button>
  );
}
