import type { AppShortcut } from "@bb/domain";
import {
  browserPlatform,
  formatAppShortcut,
  formatAppShortcutAria,
} from "@/lib/app-keybindings";

const MODIFIER_SUBMIT_SHORTCUT: AppShortcut = {
  key: "Enter",
  mod: true,
  meta: false,
  control: false,
  alt: false,
  shift: false,
};

export function isModifierSubmitKeyEvent(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function modifierSubmitShortcutLabel(): string {
  return formatAppShortcut(MODIFIER_SUBMIT_SHORTCUT, browserPlatform());
}

export function modifierSubmitShortcutAria(): string {
  return formatAppShortcutAria(MODIFIER_SUBMIT_SHORTCUT, browserPlatform());
}
