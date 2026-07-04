import { appToast } from "@/components/ui/app-toast";

interface CopyToClipboardOptions {
  /** Toast message shown on success (set to `null` to suppress). */
  successMessage?: string | null;
  /** Toast message shown on failure (set to `null` to suppress). */
  errorMessage?: string | null;
}

function writeWithClipboardApi(text: string): Promise<void> | null {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return null;
  }

  try {
    return navigator.clipboard.writeText(text);
  } catch {
    return null;
  }
}

function copyWithSelectionFallback(text: string): boolean {
  if (
    typeof document === "undefined" ||
    typeof document.execCommand !== "function" ||
    document.body === null
  ) {
    return false;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  textArea.style.left = "-9999px";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";

  const activeElement = document.activeElement;
  const selection = document.getSelection();
  const selectedRanges: Range[] = [];
  if (selection !== null) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      selectedRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  document.body.appendChild(textArea);
  textArea.focus({ preventScroll: true });
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.remove();
    if (selection !== null) {
      selection.removeAllRanges();
      for (const range of selectedRanges) {
        selection.addRange(range);
      }
    }
    if (
      typeof HTMLElement !== "undefined" &&
      activeElement instanceof HTMLElement
    ) {
      activeElement.focus({ preventScroll: true });
    }
  }
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
  const clipboardWrite = writeWithClipboardApi(text);
  let copied = false;

  if (clipboardWrite === null) {
    copied = copyWithSelectionFallback(text);
  } else {
    try {
      await clipboardWrite;
      copied = true;
    } catch {
      copied = copyWithSelectionFallback(text);
    }
  }

  if (!copied) {
    if (errorMessage) appToast.error(errorMessage);
    return false;
  }

  if (successMessage) appToast.success(successMessage);
  return true;
}
