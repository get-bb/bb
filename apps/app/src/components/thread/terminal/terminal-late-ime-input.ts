import type { IDisposable, Terminal } from "@xterm/xterm";

const IME_PROCESS_KEY_CODE = 229;

interface PendingImeKey {
  dataSent: boolean;
  xtermCheckDone: boolean;
}

export function forwardLateImeInput(
  terminal: Pick<Terminal, "input" | "onData" | "textarea">,
): IDisposable {
  const textarea = terminal.textarea;
  if (!textarea) {
    return { dispose: () => undefined };
  }
  let pending: PendingImeKey | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.keyCode !== IME_PROCESS_KEY_CODE || event.isComposing) {
      pending = null;
      return;
    }
    const key: PendingImeKey = { dataSent: false, xtermCheckDone: false };
    pending = key;
    const timer = setTimeout(() => {
      timers.delete(timer);
      key.xtermCheckDone = true;
    }, 0);
    timers.add(timer);
  };
  const handleCompositionStart = () => {
    pending = null;
  };
  const handleInput = (event: Event) => {
    const key = pending;
    if (
      key === null ||
      !(event instanceof InputEvent) ||
      event.inputType !== "insertText" ||
      event.isComposing ||
      !event.data
    ) {
      return;
    }
    pending = null;
    if (key.xtermCheckDone && !key.dataSent) {
      terminal.input(event.data);
    }
  };
  const dataSubscription = terminal.onData(() => {
    if (pending !== null) {
      pending.dataSent = true;
    }
  });

  textarea.addEventListener("keydown", handleKeyDown, true);
  textarea.addEventListener("compositionstart", handleCompositionStart, true);
  textarea.addEventListener("input", handleInput, true);
  return {
    dispose: () => {
      textarea.removeEventListener("keydown", handleKeyDown, true);
      textarea.removeEventListener(
        "compositionstart",
        handleCompositionStart,
        true,
      );
      textarea.removeEventListener("input", handleInput, true);
      dataSubscription.dispose();
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      pending = null;
    },
  };
}
