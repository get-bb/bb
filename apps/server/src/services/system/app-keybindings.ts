import type {
  AppCommandContextKey,
  AppCommandId,
  AppKeybinding,
  AppKeybindings,
  AppShortcut,
} from "@bb/domain";
import {
  QUESTION_SELECT_APP_COMMAND_IDS,
  PANE_FOCUS_APP_COMMAND_IDS,
  THREAD_JUMP_APP_COMMAND_IDS,
} from "@bb/domain";

interface ShortcutModifiers {
  mod?: boolean;
  meta?: boolean;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
}

interface BindingOptions {
  all?: readonly AppCommandContextKey[];
  desktopOnly?: boolean;
  none?: readonly AppCommandContextKey[];
}

function shortcut(key: string, modifiers: ShortcutModifiers = {}): AppShortcut {
  return {
    key,
    mod: modifiers.mod ?? false,
    meta: modifiers.meta ?? false,
    control: modifiers.control ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
  };
}

function binding(
  command: AppCommandId,
  key: string,
  modifiers: ShortcutModifiers,
  options: BindingOptions = {},
): AppKeybinding {
  return {
    command,
    desktopOnly: options.desktopOnly ?? false,
    shortcut: shortcut(key, modifiers),
    when: {
      all: [...(options.all ?? [])],
      none: [...(options.none ?? [])],
    },
  };
}

const mainWithoutModal = {
  all: ["mainSurface"],
  none: ["modalOpen"],
} as const;

const splitWithoutModal = {
  all: ["mainSurface", "splitActive"],
  none: ["modalOpen"],
} as const;

export const DEFAULT_APP_KEYBINDINGS: AppKeybindings = [
  // Browsers reserve Mod+N before the page receives a key event. Keep the
  // t3code-style alias available in web clients while desktop retains Mod+N.
  binding("thread.new", "o", { mod: true, shift: true }, mainWithoutModal),
  binding("thread.new", "n", { mod: true }, {
    ...mainWithoutModal,
    desktopOnly: true,
  }),
  binding("thread.search", "k", { mod: true }, mainWithoutModal),
  binding("settings.open", ",", { mod: true }, mainWithoutModal),
  binding("sidebar.toggle", "\\", { mod: true }, mainWithoutModal),
  binding("thread.previous", "ArrowUp", { mod: true, shift: true }, mainWithoutModal),
  binding("thread.previous", "[", { mod: true, shift: true }, {
    ...mainWithoutModal,
    desktopOnly: true,
  }),
  binding("thread.next", "ArrowDown", { mod: true, shift: true }, mainWithoutModal),
  binding("thread.next", "]", { mod: true, shift: true }, {
    ...mainWithoutModal,
    desktopOnly: true,
  }),
  ...THREAD_JUMP_APP_COMMAND_IDS.map((command, index) =>
    binding(command, String(index + 1), { mod: true }, mainWithoutModal),
  ),
  binding(
    "pane.focus.previous",
    "[",
    { mod: true, shift: true },
    splitWithoutModal,
  ),
  binding(
    "pane.focus.next",
    "]",
    { mod: true, shift: true },
    splitWithoutModal,
  ),
  ...PANE_FOCUS_APP_COMMAND_IDS.map((command, index) =>
    binding(command, String(index + 1), { mod: true }, splitWithoutModal),
  ),
  binding(
    "pane.maximize.toggle",
    "e",
    { mod: true, shift: true },
    splitWithoutModal,
  ),
  binding(
    "pane.close",
    "x",
    { mod: true, shift: true },
    splitWithoutModal,
  ),
  binding("panel.newTab", "t", { mod: true }, mainWithoutModal),
  binding("panel.close", "w", { mod: true }, mainWithoutModal),
  binding("panel.toggle", "j", { mod: true }, mainWithoutModal),
  binding("file.quickOpen", "p", { mod: true }, mainWithoutModal),
  binding("diff.toggle", "d", { mod: true }, {
    ...mainWithoutModal,
    none: ["modalOpen", "editableFocus", "terminalFocus", "browserFocus"],
  }),
  // Browsers reserve Mod+Shift+T for reopening a closed tab before the page
  // receives the event. Use Enter as the web alias and retain T on desktop.
  binding("terminal.open", "Enter", { mod: true, shift: true }, mainWithoutModal),
  binding("terminal.open", "t", { mod: true, shift: true }, {
    ...mainWithoutModal,
    desktopOnly: true,
  }),
  binding("composer.focus", "c", { mod: true, shift: true }, {
    all: ["mainSurface", "promptAvailable"],
    none: ["modalOpen", "terminalFocus", "browserFocus"],
  }),
  binding("modelPicker.toggle", "m", { mod: true, shift: true }, {
    all: ["mainSurface", "promptAvailable"],
    none: ["modalOpen", "terminalFocus", "browserFocus"],
  }),
  // The picker popover is itself modal. This later, scoped binding lets the
  // same chord close it while the general binding remains blocked by unrelated
  // dialogs.
  binding("modelPicker.toggle", "m", { mod: true, shift: true }, {
    all: ["mainSurface", "modelPickerOpen"],
    none: [],
  }),
  binding("browser.focusLocation", "l", { mod: true }, {
    all: ["mainSurface", "browserFocus"],
    desktopOnly: true,
    none: ["modalOpen"],
  }),
  binding("browser.reload", "r", { mod: true }, {
    all: ["mainSurface", "browserFocus"],
    desktopOnly: true,
    none: ["modalOpen"],
  }),
  binding("workspace.openPreferred", "o", { mod: true }, mainWithoutModal),
  ...QUESTION_SELECT_APP_COMMAND_IDS.map((command, index) =>
    binding(command, String(index + 1), {}, {
      all: ["mainSurface", "questionOpen"],
      none: ["modalOpen", "editableFocus"],
    }),
  ),
  binding("window.new", "n", { mod: true, shift: true }, {
    ...mainWithoutModal,
    desktopOnly: true,
  }),
];
