import { matchesAppShortcut } from "@bb/domain";

interface DesktopReloadShortcutInput {
  alt: boolean;
  control: boolean;
  isAutoRepeat: boolean;
  isComposing: boolean;
  key: string;
  code: string;
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
    !matchesAppShortcut(
      {
        key: input.key,
        code: input.code,
        altKey: input.alt,
        ctrlKey: input.control,
        metaKey: input.meta,
        shiftKey: input.shift,
      },
      {
        key: "r",
        mod: false,
        meta: true,
        control: false,
        alt: false,
        shift: input.shift,
      },
      true,
    )
  ) {
    return null;
  }
  return input.shift ? "force-reload" : "reload";
}
