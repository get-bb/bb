import {
  forwardRef,
  useCallback,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS } from "./hover-reveal";
import { Icon } from "./icon";
import { CONTROL_HOVER_TRANSITION } from "./motion";

const COPIED_FEEDBACK_MS = 2000;

export function useCopiedFeedback() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(
      () => setCopied(false),
      COPIED_FEEDBACK_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const markCopied = useCallback(() => setCopied(true), []);

  return { copied, markCopied };
}

interface CopyIconButtonProps extends Omit<
  ComponentPropsWithoutRef<"button">,
  "type" | "onClick" | "title"
> {
  copied: boolean;
  onCopy: () => void;
  iconClassName?: string;
  label?: string;
}

export const CopyIconButton = forwardRef<
  HTMLButtonElement,
  CopyIconButtonProps
>(function CopyIconButton(
  {
    copied,
    onCopy,
    className,
    iconClassName,
    label = "Copy to clipboard",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      {...rest}
      className={cn(
        `inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground ${CONTROL_HOVER_TRANSITION} hover:text-foreground focus-visible:opacity-100`,
        className,
      )}
      onClick={onCopy}
    >
      {copied ? (
        <Icon name="Check" className={cn("size-3", iconClassName)} />
      ) : (
        <Icon name="Copy" className={cn("size-3", iconClassName)} />
      )}
    </button>
  );
});

export interface CopyableInlineLabelViewProps {
  text: string;
  label: string;
  title?: string;
  copied: boolean;
  onCopy(): void;
  children?: ReactNode;
}

export function CopyableInlineLabelView({
  text,
  label,
  title,
  copied,
  onCopy,
  children,
}: CopyableInlineLabelViewProps) {
  return (
    <button
      type="button"
      className={`group/copy inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-foreground ${CONTROL_HOVER_TRANSITION} hover:text-foreground/80`}
      onClick={onCopy}
      aria-label={label}
    >
      <span className="min-w-0 truncate" title={title ?? text}>
        {children ?? text}
      </span>
      <Icon
        name={copied ? "Check" : "Copy"}
        className={cn(
          "size-3 shrink-0 text-subtle-foreground transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100",
          HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS,
          copied ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}
