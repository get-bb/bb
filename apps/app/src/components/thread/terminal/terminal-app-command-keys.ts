const FUNCTION_KEY = /^F(?:[1-9]|1[0-9]|2[0-4])$/u;
const CONTROL_CHARACTER_KEYS = new Set([" ", "[", "\\", "]", "/"]);

export function isTerminalShellKey(event: KeyboardEvent): boolean {
  if (FUNCTION_KEY.test(event.key) || event.altKey || event.metaKey) {
    return false;
  }
  if (!event.ctrlKey) {
    return true;
  }
  return (
    !event.shiftKey &&
    (/^Key[A-Z]$/u.test(event.code) ||
      /^[a-z]$/iu.test(event.key) ||
      CONTROL_CHARACTER_KEYS.has(event.key))
  );
}

export function createTerminalAppCommandKeyHandler(
  dispatchAppCommandKey: (event: KeyboardEvent) => boolean,
): (event: KeyboardEvent) => boolean {
  return (event) =>
    event.type !== "keydown" ||
    isTerminalShellKey(event) ||
    !dispatchAppCommandKey(event);
}
