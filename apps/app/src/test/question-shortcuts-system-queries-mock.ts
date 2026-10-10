import { defaultAppSettings, type AppKeybindings } from "@bb/domain";

const questionSelectKeybindings: AppKeybindings = ([1, 2, 3] as const).map(
  (digit) => ({
    command: `question.select.${digit}`,
    desktopOnly: false,
    shortcut: {
      key: String(digit),
      mod: false,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    when: { all: ["questionOpen"], none: [] },
  }),
);

export function useSystemConfig() {
  return {
    data: {
      generalSettings: { ...defaultAppSettings },
      keybindings: questionSelectKeybindings,
    },
  };
}
