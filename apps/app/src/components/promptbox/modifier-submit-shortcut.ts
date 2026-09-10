import type { AppShortcut } from "@bb/domain";
import {
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

function currentPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

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
  return formatAppShortcut(MODIFIER_SUBMIT_SHORTCUT, currentPlatform());
}

export function modifierSubmitShortcutAria(): string {
  return formatAppShortcutAria(MODIFIER_SUBMIT_SHORTCUT, currentPlatform());
}
