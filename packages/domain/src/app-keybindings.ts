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

export const PANE_FOCUS_APP_COMMAND_IDS = [
  "pane.focus.1",
  "pane.focus.2",
  "pane.focus.3",
  "pane.focus.4",
] as const;

export const APP_COMMAND_IDS = [
  "thread.new",
  "thread.search",
  "thread.previous",
  "thread.next",
  ...THREAD_JUMP_APP_COMMAND_IDS,
  "pane.focus.previous",
  "pane.focus.next",
  ...PANE_FOCUS_APP_COMMAND_IDS,
  "pane.close",
  "window.new",
  "settings.open",
  "settings.openServers",
  "sidebar.toggle",
  "panel.newTab",
  "panel.close",
  "panel.toggle",
  "file.quickOpen",
  "diff.toggle",
  "terminal.open",
  "composer.focus",
  "modelPicker.toggle",
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
  "promptAvailable",
  "splitActive",
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

export function normalizeAppShortcutInputKey(input: AppShortcutInput): string {
  if (input.key === " " || input.key === "Spacebar") {
    return "Space";
  }
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

export const appKeybindingOverrideSchema = z
  .object({
    command: appCommandIdSchema,
    // Null has explicit meaning: disable every default binding for this command.
    shortcut: appShortcutSchema.nullable(),
  })
  .strict();
export type AppKeybindingOverride = z.infer<typeof appKeybindingOverrideSchema>;

export const appKeybindingOverridesSchema = z
  .array(appKeybindingOverrideSchema)
  .max(APP_COMMAND_IDS.length)
  .superRefine((overrides, context) => {
    const seen = new Set<AppCommandId>();
    for (const [index, override] of overrides.entries()) {
      if (seen.has(override.command)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate override for ${override.command}`,
          path: [index, "command"],
        });
      }
      seen.add(override.command);
    }
  });
export type AppKeybindingOverrides = z.infer<
  typeof appKeybindingOverridesSchema
>;

export function applyAppKeybindingOverrides(
  defaults: AppKeybindings,
  overrides: AppKeybindingOverrides,
): AppKeybindings {
  return defaults.flatMap((binding) => {
    const override = overrides.find(
      (candidate) => candidate.command === binding.command,
    );
    if (override === undefined) {
      return [binding];
    }
    return override.shortcut === null
      ? []
      : [{ ...binding, shortcut: override.shortcut }];
  });
}
