export function skillEntryFileMode(mode: number): number {
  if (process.platform !== "win32") {
    return mode & 0o777;
  }
  return mode & 0o222 ? 0o644 : 0o444;
}
