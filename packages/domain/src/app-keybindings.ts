import { z } from "zod";

export const THREAD_JUMP_APP_COMMAND_IDS = [
  "thread.jump.1",
  "thread.jump.2",
  "thread.jump.3",
  "thread.jump.4",
  "thread.jump.5",
  "thread.jump.6",
  "thread.jump.7",
  "thread.jump.8",
  "thread.jump.9",
] as const;

export const MODEL_PICKER_SELECT_APP_COMMAND_IDS = [
  "modelPicker.select.1",
  "modelPicker.select.2",
  "modelPicker.select.3",
  "modelPicker.select.4",
  "modelPicker.select.5",
  "modelPicker.select.6",
  "modelPicker.select.7",
  "modelPicker.select.8",
  "modelPicker.select.9",
] as const;

export const QUESTION_SELECT_APP_COMMAND_IDS = [
  "question.select.1",
  "question.select.2",
  "question.select.3",
  "question.select.4",
  "question.select.5",
  "question.select.6",
  "question.select.7",
  "question.select.8",
  "question.select.9",
] as const;

export const APP_COMMAND_IDS = [
  "thread.new",
  "thread.search",
  "thread.previous",
  "thread.next",
  ...THREAD_JUMP_APP_COMMAND_IDS,
  "window.new",
  "settings.open",
  "sidebar.toggle",
  "panel.newTab",
  "panel.close",
  "panel.toggle",
  "file.quickOpen",
  "diff.toggle",
  "terminal.open",
  "modelPicker.toggle",
  ...MODEL_PICKER_SELECT_APP_COMMAND_IDS,
  "browser.focusLocation",
  "browser.reload",
  "workspace.openPreferred",
  ...QUESTION_SELECT_APP_COMMAND_IDS,
] as const;

export const appCommandIdSchema = z.enum(APP_COMMAND_IDS);
export type AppCommandId = z.infer<typeof appCommandIdSchema>;

export const APP_COMMAND_CONTEXT_KEYS = [
  "mainSurface",
  "modalOpen",
  "editableFocus",
  "terminalFocus",
  "browserFocus",
  "modelPickerOpen",
  "questionOpen",
  "panelOpen",
  "promptAvailable",
] as const;

export const appCommandContextKeySchema = z.enum(APP_COMMAND_CONTEXT_KEYS);
export type AppCommandContextKey = z.infer<
  typeof appCommandContextKeySchema
>;
export type AppCommandContext = Record<AppCommandContextKey, boolean>;

export const appShortcutSchema = z
  .object({
    // Store the unshifted base key; `shift` records the modifier separately.
    // For example, Command+Shift+[ is `{ key: "[", shift: true }`.
    key: z.string().min(1).max(32),
    mod: z.boolean(),
    meta: z.boolean(),
    control: z.boolean(),
    alt: z.boolean(),
    shift: z.boolean(),
  })
  .strict();
export type AppShortcut = z.infer<typeof appShortcutSchema>;

export interface AppShortcutInput {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

const SHIFTED_KEY_BASES: Readonly<Record<string, string>> = {
  "~": "`",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
};

function normalizeAppShortcutInputKey(input: AppShortcutInput): string {
  return input.shiftKey
    ? (SHIFTED_KEY_BASES[input.key] ?? input.key)
    : input.key;
}

export function isMacKeyboardPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/u.test(platform);
}

export function matchesAppShortcut(
  input: AppShortcutInput,
  shortcut: AppShortcut,
  useMetaForMod: boolean,
): boolean {
  const expectedMeta = shortcut.meta || (shortcut.mod && useMetaForMod);
  const expectedControl = shortcut.control || (shortcut.mod && !useMetaForMod);
  return (
    normalizeAppShortcutInputKey(input).toLowerCase() ===
      shortcut.key.toLowerCase() &&
    input.metaKey === expectedMeta &&
    input.ctrlKey === expectedControl &&
    input.altKey === shortcut.alt &&
    input.shiftKey === shortcut.shift
  );
}

export const appCommandWhenSchema = z
  .object({
    all: z.array(appCommandContextKeySchema),
    none: z.array(appCommandContextKeySchema),
  })
  .strict();
export type AppCommandWhen = z.infer<typeof appCommandWhenSchema>;

export const appKeybindingSchema = z
  .object({
    command: appCommandIdSchema,
    desktopOnly: z.boolean(),
    shortcut: appShortcutSchema,
    when: appCommandWhenSchema,
  })
  .strict();
export type AppKeybinding = z.infer<typeof appKeybindingSchema>;

export const appKeybindingsSchema = z.array(appKeybindingSchema).max(256);
export type AppKeybindings = z.infer<typeof appKeybindingsSchema>;
