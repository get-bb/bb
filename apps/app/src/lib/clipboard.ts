import { useCallback, useEffect, useState } from "react";
import { appToast } from "@/components/ui/app-toast";

interface CopyToClipboardOptions {
  successMessage?: string | null;
  errorMessage?: string | null;
}

function copyWithEditingCommand(text: string): boolean {
  if (
    typeof document === "undefined" ||
    document.body === null ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const selection = document.getSelection();
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    border: "0",
    height: "1px",
    left: "0",
    opacity: "0",
    padding: "0",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: "1px",
  });
  document.body.append(textarea);

  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    if (activeElement?.isConnected) {
      activeElement.focus({ preventScroll: true });
    }
    if (selection) {
      selection.removeAllRanges();
      for (const range of selectedRanges) {
        selection.addRange(range);
      }
    }
  }
  return copied;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  return copyWithEditingCommand(text);
}

export async function copyToClipboardWithToast(
  text: string,
  {
    successMessage = "Copied",
    errorMessage = "Failed to copy",
  }: CopyToClipboardOptions = {},
): Promise<boolean> {
  const copied = await copyTextToClipboard(text);
  if (copied) {
    if (successMessage) appToast.success(successMessage);
    return true;
  }
  if (errorMessage) appToast.error(errorMessage);
  return false;
}

export interface ClipboardCopyOptions extends CopyToClipboardOptions {
  text: string;
}

export function useClipboardCopy({
  text,
  successMessage = null,
  errorMessage = "Failed to copy",
}: ClipboardCopyOptions) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 2000);
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
