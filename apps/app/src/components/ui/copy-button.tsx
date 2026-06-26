import {
  forwardRef,
  useCallback,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon.js";

interface ClipboardCopyOptions {
  text: string;
  successMessage?: string | null;
  errorMessage?: string | null;
}

function useClipboardCopy({
  text,
  successMessage = null,
  errorMessage = "Failed to copy",
}: ClipboardCopyOptions) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const copy = useCallback(async () => {
    if (!text || copied) return;
    const success = await copyToClipboardWithToast(text, {
      successMessage,
      errorMessage,
    });
    if (success) setCopied(true);
  }, [text, copied, successMessage, errorMessage]);

  return { copied, copy };
}

interface CopyButtonProps
  extends ClipboardCopyOptions,
    Omit<ComponentPropsWithoutRef<"button">, "type" | "onClick" | "title"> {
  iconClassName?: string;
  label?: string;
}

// forwardRef + prop spreading so it can act as a Radix `asChild` trigger (e.g.
// wrapped in a Tooltip) without also creating a native browser tooltip.
export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(
  function CopyButton(
    {
      text,
      className,
      iconClassName,
      label = "Copy to clipboard",
      successMessage,
      errorMessage,
      ...rest
    },
    ref,
  ) {
    const { copied, copy } = useClipboardCopy({
      text,
      successMessage,
      errorMessage,
    });

    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        {...rest}
        className={cn(
          "inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground focus-visible:opacity-100",
          className,
        )}
        onClick={() => {
          void copy();
        }}
      >
        {copied ? (
          <Icon name="Check" className={cn("size-3", iconClassName)} />
        ) : (
          <Icon name="Copy" className={cn("size-3", iconClassName)} />
        )}
      </button>
    );
  },
);

interface CopyableInlineLabelProps extends ClipboardCopyOptions {
  label: string;
  title?: string;
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
}

export function CopyableInlineLabel({
  text,
  label,
  title,
  className,
  iconClassName,
  successMessage,
  errorMessage,
  children,
}: CopyableInlineLabelProps) {
  const { copied, copy } = useClipboardCopy({
    text,
    successMessage,
    errorMessage,
  });

  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-foreground transition-colors hover:text-foreground/80",
        className,
      )}
      onClick={() => {
        void copy();
      }}
      aria-label={label}
    >
      <span className="min-w-0 truncate" title={title ?? text}>
        {children ?? text}
      </span>
      <Icon
        name={copied ? "Check" : "Copy"}
        className={cn("size-3.5 shrink-0 text-muted-foreground", iconClassName)}
      />
    </button>
  );
}
