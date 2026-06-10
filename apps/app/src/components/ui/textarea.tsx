/* shadcn/ui-derived */
import * as React from "react";

import { COARSE_POINTER_TEXT_BASE_CLASS } from "./coarse-pointer-sizing.js";
import { cn } from "@/lib/utils";

/**
 * The multiline counterpart of `Input`, sharing its field styling tokens
 * (border, focus ring, placeholder, disabled treatment). Reach for this
 * before hand-rolling a `<textarea>` class bundle.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      autoComplete="off"
      className={cn(
        "flex w-full rounded-md border border-input bg-transparent px-3 py-2 transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        COARSE_POINTER_TEXT_BASE_CLASS,
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
