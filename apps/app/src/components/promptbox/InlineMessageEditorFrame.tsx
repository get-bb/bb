import type { ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";

interface InlineMessageEditorFrameProps {
  cancelLabel: string;
  children: ReactNode;
  label: string;
  onCancel: () => void;
  variant?: "embedded" | "cap";
}

/** Shared chrome for compact editors shown inline with a message. */
export function InlineMessageEditorFrame({
  cancelLabel,
  children,
  label,
  onCancel,
  variant = "embedded",
}: InlineMessageEditorFrameProps) {
  const header = (
    <div
      className={cn(
        "flex min-h-7 items-center gap-1.5 text-xs text-subtle-foreground",
        variant === "cap" ? "h-8 px-3" : "mb-1.5 pl-1",
      )}
    >
      <Icon name="Edit" className="size-3.5 shrink-0" aria-hidden />
      <span className={cn("shrink-0", variant === "cap" && "font-medium")}>
        {label}
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        /* 24px is the smallest target in the app and the only exit from edit
           mode. Coarse pointers get a real target; precise pointers keep the
           compact size. */
        className="ml-auto size-6 shrink-0 text-subtle-foreground max-md:pointer-coarse:size-11"
        onClick={onCancel}
        aria-label={cancelLabel}
      >
        <Icon
          name="X"
          className="size-3 max-md:pointer-coarse:size-4"
          aria-hidden
        />
      </Button>
    </div>
  );

  if (variant === "cap") {
    return (
      <div
        className="relative z-20 space-y-2"
        data-inline-message-editor-frame="cap"
      >
        <PromptStackCard
          ariaLabel={label}
          className="relative z-10 -mb-5 rounded-xl rounded-b-none border-b-0 bg-surface-raised-solid pb-3 shadow-lift"
        >
          {header}
        </PromptStackCard>
        <div className="relative z-20">{children}</div>
      </div>
    );
  }

  return (
    <div className="relative z-20" data-inline-message-editor-frame="embedded">
      {header}
      {children}
    </div>
  );
}
