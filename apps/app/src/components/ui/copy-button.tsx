import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { useClipboardCopy, type ClipboardCopyOptions } from "@/lib/clipboard";
import {
  CopyableInlineLabelView,
  CopyIconButton,
} from "@bb/shared-ui/copy-button";

interface CopyButtonProps
  extends
    ClipboardCopyOptions,
    Omit<ComponentPropsWithoutRef<"button">, "type" | "onClick" | "title"> {
  iconClassName?: string;
  label?: string;
}

export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(
  function CopyButton(
    { text, successMessage, errorMessage, imageUrl, ...rest },
    ref,
  ) {
    const { copied, copy } = useClipboardCopy({
      text,
      successMessage,
      errorMessage,
      imageUrl,
    });

    return (
      <CopyIconButton
        ref={ref}
        {...rest}
        copied={copied}
        onCopy={() => {
          void copy();
        }}
      />
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
  const { copied, copy } = useClipboardCopy({
    text,
    successMessage,
    errorMessage,
  });

  return (
    <CopyableInlineLabelView
      text={text}
      label={label}
      title={title}
      copied={copied}
      onCopy={() => {
        void copy();
      }}
    >
      {children}
    </CopyableInlineLabelView>
  );
}
