import type {
  AppCommandContextKey,
  AppCommandId,
  AppDefaultKeybinding,
  AppDefaultKeybindings,
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

function unassignedBinding(
  command: AppCommandId,
  options: BindingOptions = {},
): AppDefaultKeybinding {
  return {
    command,
    desktopOnly: options.desktopOnly ?? false,
    shortcut: null,
    when: {
      all: [...(options.all ?? [])],
      none: [...(options.none ?? [])],
    },
  };
}

function numberedChatBindings(
  commands: readonly AppCommandId[],
  options: BindingOptions,
): AppKeybindings {
  return commands.flatMap((command, index) => [
    binding(
      command,
      String(index + 1),
      { control: true },
      {
        ...options,
        all: [...(options.all ?? []), "webSurface", "macPlatform"],
      },
    ),
    binding(
      command,
      String(index + 1),
      { mod: true, shift: true },
      {
        ...options,
        all: [...(options.all ?? []), "webSurface"],
        none: [...(options.none ?? []), "macPlatform"],
      },
    ),
    binding(
      command,
      String(index + 1),
      { mod: true },
      {
        ...options,
        desktopOnly: true,
      },
    ),
  ]);
}

const mainWithoutModal = {
  all: ["mainSurface"],
  none: ["modalOpen"],
} as const;

const composerWithoutModal = {
  all: ["mainSurface", "promptAvailable"],
  none: ["modalOpen", "terminalFocus", "browserFocus"],
} as const;

// The model picker's popover is itself modal, so chords that must survive it
// carry a second copy scoped to the open picker alone.
const pickerOpenOnly = {
  all: ["mainSurface", "modelPickerOpen"],
  none: [],
} as const;

const webMainWithoutModal = {
  all: ["mainSurface", "webSurface"],
  none: ["modalOpen"],
} as const;

const splitWithoutModal = {
  all: ["mainSurface", "splitActive"],
  none: ["modalOpen"],
} as const;

export const DEFAULT_APP_KEYBINDINGS: AppDefaultKeybindings = [
  // Browsers reserve Mod+N before the page receives a key event. Keep the
  // t3code-style alias available in web clients while desktop retains Mod+N.
  binding("thread.new", "o", { mod: true, shift: true }, mainWithoutModal),
  binding("thread.new", "n", { mod: true }, {
    ...mainWithoutModal,
    desktopOnly: true,
  }),
  binding("thread.search", "k", { mod: true }, mainWithoutModal),
  unassignedBinding("thread.rename", mainWithoutModal),
  unassignedBinding("thread.archive", mainWithoutModal),
  binding("settings.open", ",", { mod: true }, mainWithoutModal),
  binding("sidebar.toggle", "\\", { mod: true }, mainWithoutModal),
  binding(
    "thread.previous",
    "[",
    { control: true, shift: true },
    webMainWithoutModal,
  ),
  binding("thread.previous", "[", { mod: true, shift: true }, {
    ...mainWithoutModal,
    desktopOnly: true,
  }),
  binding(
    "thread.next",
    "]",
    { control: true, shift: true },
    webMainWithoutModal,
  ),
  binding("thread.next", "]", { mod: true, shift: true }, {
    ...mainWithoutModal,
    desktopOnly: true,
  }),
  // Browsers reserve Mod+1…9 for native tab switching. Match Slack's web
  // navigation convention: Control+N on macOS and Ctrl+Shift+N elsewhere,
  // while keeping the shorter Mod chord on desktop.
  ...numberedChatBindings(THREAD_JUMP_APP_COMMAND_IDS, mainWithoutModal),
  unassignedBinding("pane.focus.previous", splitWithoutModal),
  unassignedBinding("pane.focus.next", splitWithoutModal),
  ...numberedChatBindings(PANE_FOCUS_APP_COMMAND_IDS, splitWithoutModal),
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
  binding("composer.focus", "c", { mod: true, shift: true }, composerWithoutModal),
  binding("modelPicker.toggle", "m", { mod: true, shift: true }, composerWithoutModal),
  // This later, scoped binding lets the same chord close the picker while the
  // general binding remains blocked by unrelated dialogs.
  binding("modelPicker.toggle", "m", { mod: true, shift: true }, pickerOpenOnly),
  // Rotate the composer's provider, model, and reasoning level in either
  // direction without opening the picker, scoped exactly like
  // `modelPicker.toggle` above. Alt is otherwise unused by bb, the browser, and
  // both desktop menus, so these chords conflict with no app shortcut. macOS
  // composes Option+<letter> into another character, so they match on the
  // physical key — see `normalizeAppShortcutInputKey` in @bb/domain.
  binding("modelPicker.cycleModel", "m", { alt: true }, composerWithoutModal),
  binding(
    "modelPicker.cycleModelBackward",
    "m",
    { alt: true, shift: true },
    composerWithoutModal,
  ),
  binding("modelPicker.cycleProvider", "p", { alt: true }, composerWithoutModal),
  binding(
    "modelPicker.cycleProviderBackward",
    "p",
    { alt: true, shift: true },
    composerWithoutModal,
  ),
  binding("modelPicker.cycleReasoning", "t", { alt: true }, composerWithoutModal),
  binding(
    "modelPicker.cycleReasoningBackward",
    "t",
    { alt: true, shift: true },
    composerWithoutModal,
  ),
  // The cycle bindings above stop the moment the popover opens. These later,
  // scoped copies keep cycling available while it is open — the same escape
  // hatch `modelPicker.toggle` uses to close itself.
  binding("modelPicker.cycleModel", "m", { alt: true }, pickerOpenOnly),
  binding(
    "modelPicker.cycleModelBackward",
    "m",
    { alt: true, shift: true },
    pickerOpenOnly,
  ),
  binding("modelPicker.cycleProvider", "p", { alt: true }, pickerOpenOnly),
  binding(
    "modelPicker.cycleProviderBackward",
    "p",
    { alt: true, shift: true },
    pickerOpenOnly,
  ),
  binding("modelPicker.cycleReasoning", "t", { alt: true }, pickerOpenOnly),
  binding(
    "modelPicker.cycleReasoningBackward",
    "t",
    { alt: true, shift: true },
    pickerOpenOnly,
  ),
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
  binding("browser.find", "f", { mod: true }, {
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
