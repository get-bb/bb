interface DesktopReloadShortcutInput {
  alt: boolean;
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
    input.key.toLowerCase() !== "r"
  ) {
    return null;
  }
  return input.shift ? "force-reload" : "reload";
}
