import type { Terminal as XTermTerminal } from "@xterm/xterm";

interface AttachTerminalCopyShortcutArgs {
  copy: (text: string) => void;
  terminal: Pick<XTermTerminal, "attachCustomKeyEventHandler" | "getSelection">;
}

function isCopyChord(event: KeyboardEvent): boolean {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
    return false;
  }
  return /^[a-z]$/iu.test(event.key)
    ? event.key.toLowerCase() === "c"
    : event.code === "KeyC";
}

export function attachTerminalCopyShortcut({
  copy,
  terminal,
}: AttachTerminalCopyShortcutArgs): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (!isCopyChord(event)) {
      return true;
    }
    event.preventDefault();
    event.stopPropagation();
    const selection = terminal.getSelection();
    if (event.type === "keydown" && selection.length > 0) {
      copy(selection);
    }
    return false;
  });
}
