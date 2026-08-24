import { useCallback, useEffect, useState } from "react";
import { appToast } from "@/components/ui/app-toast";

interface CopyToClipboardOptions {
  /** Toast message shown on success (set to `null` to suppress). */
  successMessage?: string | null;
  /** Toast message shown on failure (set to `null` to suppress). */
  errorMessage?: string | null;
}

/**
 * Copies through the browser's legacy editing command. Unlike the async
 * Clipboard API, this remains available on plain-HTTP LAN origins when it is
 * called synchronously from a user gesture.
 */
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

/**
 * Copies text using the modern API where available, with a user-gesture
 * fallback for browsers serving bb from a non-secure LAN origin.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // A present Clipboard API can still reject because of origin policy or
      // permissions. The synchronous editing command may remain available.
    }
  }
  return copyWithEditingCommand(text);
}

/**
 * Copies text to the clipboard and surfaces success/failure via appToast.
 * Returns `true` on success, `false` on failure.
 */
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
