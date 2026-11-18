import { matchesAppShortcutKey } from "@bb/domain";
import { isImeComposing } from "@bb/shared-ui/lib/ime-keyboard";
import type { Terminal } from "@xterm/xterm";

export function createTerminalClipboardKeyHandler({
  terminal,
  copy,
  paste,
}: {
  terminal: Pick<Terminal, "getSelection">;
  copy: (text: string) => void;
  paste: () => void;
}): (event: KeyboardEvent) => boolean {
  return (event) => {
    if (
      isImeComposing(event) ||
      event.altKey ||
      (event.ctrlKey && event.metaKey) ||
      (!event.ctrlKey && !event.metaKey)
    ) {
      return true;
    }

    const key = matchesAppShortcutKey(event, "c")
      ? "c"
      : matchesAppShortcutKey(event, "v")
        ? "v"
        : null;
    if (key === null) {
      return true;
    }

    const selection = key === "c" ? terminal.getSelection() : "";
    if (key === "c" && event.ctrlKey && !event.shiftKey) {
      return true;
    }

    if (event.type !== "keydown") {
      return false;
    }

    event.stopPropagation();
    if (key === "v" && !event.shiftKey) {
      return false;
    }

    event.preventDefault();
    if (event.repeat) {
      return false;
    }
    if (key === "c") {
      if (selection.length > 0) {
        copy(selection);
      }
    } else {
      paste();
    }
    return false;
  };
}

export function createTerminalSelectionClipboardHandler(
  copy: (text: string) => void,
): (text: string) => void {
  let previousSelection = "";
  return (text) => {
    if (text === previousSelection) {
      return;
    }
    previousSelection = text;
    if (text.length > 0) {
      copy(text);
    }
  };
}

export async function pasteTerminalClipboard({
  terminal,
  readText,
  isActive,
}: {
  terminal: Pick<Terminal, "focus" | "paste">;
  readText: () => Promise<string>;
  isActive: () => boolean;
}): Promise<void> {
  const text = await readText();
  if (!isActive()) {
    return;
  }
  terminal.focus();
  terminal.paste(text);
}
