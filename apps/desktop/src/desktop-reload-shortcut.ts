import { matchesAppShortcutKey } from "@bb/domain";

interface DesktopReloadShortcutInput {
  alt: boolean;
  code: string;
  control: boolean;
  isAutoRepeat: boolean;
  isComposing: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
  type: string;
}

type DesktopReloadShortcut = "reload" | "force-reload";

export function resolveDesktopReloadShortcut(
  input: DesktopReloadShortcutInput,
): DesktopReloadShortcut | null {
  if (
    input.type !== "keyDown" ||
    input.isAutoRepeat ||
    input.isComposing ||
    input.alt ||
    input.control ||
    !input.meta ||
    !matchesAppShortcutKey(
      {
        key: input.key,
        code: input.code,
        altKey: input.alt,
        shiftKey: input.shift,
      },
      "r",
    )
  ) {
    return null;
  }
  return input.shift ? "force-reload" : "reload";
}
