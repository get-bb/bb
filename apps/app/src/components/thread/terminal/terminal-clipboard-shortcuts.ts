import type { Terminal as XTermTerminal } from "@xterm/xterm";

type TerminalClipboardShortcut = "copy" | "paste";

type TerminalClipboardShortcutInput = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

interface AttachTerminalClipboardShortcutsArgs {
  copy: (text: string) => void;
  isMac: boolean;
  terminal: Pick<XTermTerminal, "attachCustomKeyEventHandler" | "getSelection">;
}

function terminalShortcutLetter({
  code,
  key,
}: TerminalClipboardShortcutInput): string | null {
  if (/^[a-z]$/iu.test(key)) {
    return key.toLowerCase();
  }
  return /^Key[A-Z]$/u.test(code) ? code.slice(3).toLowerCase() : null;
}

export function matchTerminalClipboardShortcut(
  input: TerminalClipboardShortcutInput,
  isMac: boolean,
): TerminalClipboardShortcut | null {
  const modifiersMatch = isMac
    ? input.metaKey && !input.ctrlKey && !input.shiftKey
    : input.ctrlKey && input.shiftKey && !input.metaKey;
  if (!modifiersMatch || input.altKey) {
    return null;
  }
  switch (terminalShortcutLetter(input)) {
    case "c":
      return "copy";
    case "v":
      return "paste";
    default:
      return null;
  }
}

export function attachTerminalClipboardShortcuts({
  copy,
  isMac,
  terminal,
}: AttachTerminalClipboardShortcutsArgs): void {
  terminal.attachCustomKeyEventHandler((event) => {
    const shortcut = matchTerminalClipboardShortcut(event, isMac);
    if (shortcut === null) {
      return true;
    }
    event.stopPropagation();
    if (shortcut === "paste") {
      return false;
    }
    event.preventDefault();
    const selection = terminal.getSelection();
    if (event.type === "keydown" && selection.length > 0) {
      copy(selection);
    }
    return false;
  });
}
