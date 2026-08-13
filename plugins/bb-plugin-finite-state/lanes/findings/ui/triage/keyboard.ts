import { useEffect } from "react";
import { VEX_SHORTCUTS } from "./validation.js";

export type TriageShortcut =
  | { action: "move"; delta: -1 | 1 }
  | { action: "open" | "filter" | "toggle" | "range" | "bulk" | "undo" | "sheet" }
  | { action: "status"; status: (typeof VEX_SHORTCUTS)[keyof typeof VEX_SHORTCUTS] };

export function isShortcutSuppressed(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLButtonElement
    || target instanceof HTMLAnchorElement
    || target.isContentEditable
    || target.closest('[contenteditable="true"], [role="dialog"], [role="combobox"], [role="menu"], [role="listbox"]') !== null;
}

export function shortcutFor(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">): TriageShortcut | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "j") return { action: "move", delta: 1 };
  if (event.key === "k") return { action: "move", delta: -1 };
  if (event.key === "Enter") return { action: "open" };
  if (event.key === "/") return { action: "filter" };
  if (event.key === "x") return { action: "toggle" };
  if (event.key === "X") return { action: "range" };
  if (event.key === "b") return { action: "bulk" };
  if (event.key === "u") return { action: "undo" };
  if (event.key === "?") return { action: "sheet" };
  if (Object.hasOwn(VEX_SHORTCUTS, event.key)) {
    return { action: "status", status: VEX_SHORTCUTS[event.key as keyof typeof VEX_SHORTCUTS] };
  }
  return null;
}

export function useFindingsShortcuts(
  active: boolean,
  onShortcut: (shortcut: TriageShortcut) => void,
): void {
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (isShortcutSuppressed(event.target)) return;
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      event.preventDefault();
      onShortcut(shortcut);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, onShortcut]);
}
