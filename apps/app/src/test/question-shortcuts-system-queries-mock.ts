import { defaultAppSettings, type AppKeybindings } from "@bb/domain";

const NO_MODIFIERS = {
  mod: false,
  meta: false,
  control: false,
  alt: false,
  shift: false,
};

const questionKeybindings: AppKeybindings = [
  ...([1, 2, 3] as const).map((digit) => ({
    command: `question.select.${digit}` as const,
    desktopOnly: false,
    shortcut: { ...NO_MODIFIERS, key: String(digit) },
    when: { all: ["questionOpen" as const], none: [] },
  })),
  ...(
    [
      ["question.submit", "Enter"],
      ["question.cancel", "."],
    ] as const
  ).flatMap(([command, key]) => [
    {
      command,
      desktopOnly: false,
      shortcut: { ...NO_MODIFIERS, key, mod: true },
      when: {
        all: ["mainSurface" as const, "questionOpen" as const],
        none: ["modalOpen" as const, "editableFocus" as const],
      },
    },
    {
      command,
      desktopOnly: false,
      shortcut: { ...NO_MODIFIERS, key, mod: true },
      when: {
        all: ["mainSurface" as const, "questionFocus" as const],
        none: ["modalOpen" as const],
      },
    },
  ]),
  ...(
    [
      ["question.previous", "ArrowLeft"],
      ["question.next", "ArrowRight"],
    ] as const
  ).map(([command, key]) => ({
    command,
    desktopOnly: false,
    shortcut: { ...NO_MODIFIERS, key },
    when: {
      all: ["mainSurface" as const, "questionFocus" as const],
      none: ["modalOpen" as const, "editableFocus" as const],
    },
  })),
];

export function useSystemConfig() {
  return {
    data: {
      generalSettings: { ...defaultAppSettings },
      keybindings: questionKeybindings,
    },
  };
}
