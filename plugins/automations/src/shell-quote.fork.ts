// bb-fork(windows): the CLI prints a "run this to refresh the snapshot" command for the
// operator to paste into a shell. cmd.exe reads single quotes literally, so a Windows
// value is quoted with double quotes, and a backslash-bearing path needs no quotes at all.
const WINDOWS_SAFE = /^[A-Za-z0-9_./\\:@%+=,-]+$/u;

export function forkShellQuote(
  value: string,
  posixQuote: (input: string) => string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") {
    return posixQuote(value);
  }
  return WINDOWS_SAFE.test(value)
    ? value
    : `"${value.replaceAll('"', '""')}"`;
}
