import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

interface OpenInEditorButtonProps
  extends Omit<
    ComponentPropsWithoutRef<"button">,
    "type" | "onClick" | "title"
  > {
  onClick: () => void;
  /** aria-label; defaults to "Open in editor". */
  label?: string;
  /** Native title. Pass `null` when wrapping in a design-system tooltip. */
  title?: string | null;
}

/** Muted icon button that opens the associated file in the user's editor. */
export const OpenInEditorButton = forwardRef<
  HTMLButtonElement,
  OpenInEditorButtonProps
>(function OpenInEditorButton(
  {
    className,
    onClick,
    label = "Open in editor",
    title = "Open in editor",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      onClick={onClick}
      aria-label={label}
      title={title ?? undefined}
      className={cn(
        "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      <Icon name="ExternalLink" aria-hidden className="size-3" />
    </button>
  );
});
