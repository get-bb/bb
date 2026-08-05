const TERMINAL_TOKEN_MAX_LENGTH = 128;
const BARE_TERMINAL_TOKEN = /^[A-Z][A-Z0-9_]*$/u;

export function extractTerminalToken(
  text: string | null | undefined,
): string | null {
  if (text === null || text === undefined) return null;
  const lines = text.replace(/\r\n?|\n/gu, "\n").split("\n");
  let index = lines.length - 1;
  while (index >= 0 && lines[index]?.trim().length === 0) index -= 1;
  const line = lines[index]?.trim();
  if (
    line === undefined ||
    line.length === 0 ||
    line.length > TERMINAL_TOKEN_MAX_LENGTH ||
    !BARE_TERMINAL_TOKEN.test(line)
  ) {
    return null;
  }
  return line;
}
