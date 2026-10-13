export type TerminalNavigationKey = "left" | "down" | "up" | "right";

const ARROW_SUFFIXES = { left: "D", down: "B", up: "A", right: "C" };

export function encodeTerminalArrow(
  key: TerminalNavigationKey,
  applicationCursorKeys: boolean,
): string {
  return `\x1b${applicationCursorKeys ? "O" : "["}${ARROW_SUFFIXES[key]}`;
}

export function applyTerminalControl(data: string): string {
  if (data.length !== 1 || !/^[a-zA-Z@\[\]\\^_?]$/u.test(data)) return data;
  return data === "?"
    ? "\x7f"
    : String.fromCharCode(data.toUpperCase().charCodeAt(0) & 0x1f);
}
