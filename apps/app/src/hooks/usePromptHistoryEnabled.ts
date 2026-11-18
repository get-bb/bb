import { useSyncExternalStore } from "react";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { isImeComposing } from "@bb/shared-ui/lib/ime-keyboard";

let keyboardSeen = false;
const listeners = new Set<() => void>();

function handleKeyDown(event: KeyboardEvent): void {
  if (isImeComposing(event)) {
    return;
  }
  keyboardSeen = true;
  window.removeEventListener("keydown", handleKeyDown, true);
  for (const listener of listeners) {
    listener();
  }
}

function subscribeKeyboardSeen(listener: () => void): () => void {
  listeners.add(listener);
  if (!keyboardSeen && listeners.size === 1) {
    window.addEventListener("keydown", handleKeyDown, true);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("keydown", handleKeyDown, true);
    }
  };
}

function getKeyboardSeenSnapshot(): boolean {
  return keyboardSeen;
}

function getKeyboardSeenServerSnapshot(): boolean {
  return false;
}

function useKeyboardSeen(): boolean {
  return useSyncExternalStore(
    subscribeKeyboardSeen,
    getKeyboardSeenSnapshot,
    getKeyboardSeenServerSnapshot,
  );
}

export function resetKeyboardSeenForTests(): void {
  keyboardSeen = false;
  window.removeEventListener("keydown", handleKeyDown, true);
  if (listeners.size > 0) {
    window.addEventListener("keydown", handleKeyDown, true);
  }
}

export function usePromptHistoryEnabled(): boolean {
  const isPointerCoarse = usePointerCoarse();
  const hasSeenKeyboard = useKeyboardSeen();
  return !isPointerCoarse || hasSeenKeyboard;
}
