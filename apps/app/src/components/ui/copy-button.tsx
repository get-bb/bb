import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { useClipboardCopy, type ClipboardCopyOptions } from "@/lib/clipboard";
import { HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS } from "@bb/shared-ui/hover-reveal";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { CONTROL_HOVER_TRANSITION } from "@bb/shared-ui/motion";

interface CopyButtonProps
  extends
    ClipboardCopyOptions,
    Omit<ComponentPropsWithoutRef<"button">, "type" | "onClick" | "title"> {
  iconClassName?: string;
  label?: string;
  experimental_inlineLabel?: { title?: string };
}

export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(
  function CopyButton(
    {
      text,
      className,
      iconClassName,
      label = "Copy to clipboard",
      successMessage,
      errorMessage,
      imageUrl,
      children,
      experimental_inlineLabel,
      ...rest
    },
    ref,
  ) {
    const { copied, copy } = useClipboardCopy({
      text,
      successMessage,
      errorMessage,
      imageUrl,
    });

    if (experimental_inlineLabel !== undefined)
      return (
        <button
          ref={ref}
          {...rest}
          type="button"
          className={cn(
            `group/copy inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-foreground ${CONTROL_HOVER_TRANSITION} hover:text-foreground/80`,
            className,
          )}
          onClick={() => {
            void copy();
          }}
          aria-label={label}
        >
          <span
            className="min-w-0 truncate"
            title={experimental_inlineLabel.title ?? text}
          >
            {children ?? text}
          </span>
          <Icon
            name={copied ? "Check" : "Copy"}
            className={cn(
              "size-3 shrink-0 text-subtle-foreground transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100",
              HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS,
              copied ? "opacity-100" : "opacity-0",
              iconClassName,
            )}
          />
        </button>
      );

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
  children?: ReactNode;
}

export function CopyableInlineLabel({
  text,
  label,
  title,
  successMessage,
  errorMessage,
  children,
}: CopyableInlineLabelProps) {
  return (
    <CopyButton
      text={text}
      label={label}
      successMessage={successMessage}
      errorMessage={errorMessage}
      experimental_inlineLabel={{ title }}
    >
      {children}
    </CopyButton>
  );
}
