export function modelLabel(model: string): string {
  const parts = model
    .replace(/^(?:anthropic[-/])?claude-/i, "")
    .split("-")
    .filter(Boolean);
  const versionStart = parts.findIndex((part) => /^\d+$/.test(part));
  const nameParts = versionStart === -1 ? parts : parts.slice(0, versionStart);
  const versionParts = versionStart === -1 ? [] : parts.slice(versionStart);
  const name = nameParts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const [major, minor, ...qualifiers] = versionParts;
  const version = major
    ? [minor ? `${major}.${minor}` : major, ...qualifiers].join(" ")
    : "";
  return [name, version].filter(Boolean).join(" ") || model;
}
