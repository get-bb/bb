export interface WorkspaceScripts {
  run: string | null;
  runMode: "concurrent" | "nonconcurrent";
}

export const SETTINGS_FILES = [
  ".conductor/settings.toml",
  "conductor.json",
] as const;

function unquoteTomlString(raw: string): string | null {
  const value = raw.trim();
  if (value.startsWith('"""') || value.startsWith("'''")) return null;
  if (value.startsWith('"')) {
    let end = 1;
    while (end < value.length && value[end] !== '"') {
      end += value[end] === "\\" ? 2 : 1;
    }
    if (end >= value.length) return null;
    try {
      const parsed: unknown = JSON.parse(value.slice(0, end + 1));
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end === -1 ? null : value.slice(1, end);
  }
  return null;
}

export function parseSettingsToml(text: string): WorkspaceScripts {
  const scripts: WorkspaceScripts = { run: null, runMode: "nonconcurrent" };
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null) {
      section = header[1]?.trim() ?? "";
      continue;
    }
    const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (assignment === null) continue;
    const key =
      section === "" ? (assignment[1] ?? "") : `${section}.${assignment[1]}`;
    const value = unquoteTomlString(assignment[2] ?? "");
    if (value === null) continue;
    if (key === "scripts.run") scripts.run = value.trim() || null;
    if (key === "scripts.runMode" && value === "concurrent") {
      scripts.runMode = "concurrent";
    }
  }
  return scripts;
}

export function parseConductorJson(text: string): WorkspaceScripts {
  const scripts: WorkspaceScripts = { run: null, runMode: "nonconcurrent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return scripts;
  }
  if (typeof parsed !== "object" || parsed === null) return scripts;
  const section: unknown = Reflect.get(parsed, "scripts");
  if (typeof section !== "object" || section === null) return scripts;
  const run: unknown = Reflect.get(section, "run");
  const runMode: unknown = Reflect.get(section, "runMode");
  if (typeof run === "string" && run.trim() !== "") scripts.run = run.trim();
  if (runMode === "concurrent") scripts.runMode = "concurrent";
  return scripts;
}

export function parseSettingsFile(
  file: (typeof SETTINGS_FILES)[number],
  text: string,
): WorkspaceScripts {
  return file === "conductor.json"
    ? parseConductorJson(text)
    : parseSettingsToml(text);
}
