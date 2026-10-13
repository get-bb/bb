import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { runCommand, type CommandRunner } from "./mac-app-icon.js";
import type { BrowserImportPathContext } from "./sources.js";

const macApplicationSchema = z.object({
  CFBundleName: z.string().optional(),
  CFBundleExecutable: z.string().optional(),
  CFBundleIdentifier: z.string().optional(),
  CrProductDirName: z.string().optional(),
  CFBundleURLTypes: z
    .array(
      z.object({
        CFBundleURLSchemes: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

function applicationNames(names: readonly (string | undefined)[]): string[] {
  return [
    ...new Set(
      names
        .flatMap((name) => {
          if (!name) return [];
          const normalized = name.trim().replace(/^\./, "").toLowerCase();
          return [normalized, normalized.replace(/ browser$/, "")];
        })
        .filter((name) => name.length > 0 && !/[\/\\\u0000-\u001f]/.test(name)),
    ),
  ];
}

export function parseMacBrowserApplication(
  json: string,
  appName: string,
): string[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  const parsed = macApplicationSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const info = parsed.data;
  const schemes = new Set(
    info.CFBundleURLTypes?.flatMap((type) => type.CFBundleURLSchemes ?? []),
  );
  if (!schemes.has("http") || !schemes.has("https")) return undefined;
  return applicationNames([
    appName,
    info.CFBundleName,
    info.CFBundleExecutable,
    info.CFBundleIdentifier,
    info.CrProductDirName && basename(info.CrProductDirName),
  ]);
}

export function parseLinuxBrowserApplication(
  contents: string,
  desktopName: string,
): string[] | undefined {
  const fields = new Map<string, string>();
  let inEntry = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0)
      fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const types = new Set(fields.get("MimeType")?.split(";"));
  if (
    fields.get("Type") !== "Application" ||
    fields.get("Hidden") === "true" ||
    !fields.get("Categories")?.split(";").includes("WebBrowser") ||
    !types.has("x-scheme-handler/http") ||
    !types.has("x-scheme-handler/https")
  )
    return undefined;
  return applicationNames([
    desktopName,
    fields.get("Name"),
    fields.get("StartupWMClass"),
    fields.get("X-Flatpak"),
    fields.get("X-SnapInstanceName"),
  ]);
}

async function entries(path: string, extension: string): Promise<string[]> {
  try {
    return (await readdir(path))
      .filter((name) => name.endsWith(extension))
      .sort()
      .slice(0, 256);
  } catch {
    return [];
  }
}

export async function listBrowserStorageNames(
  context: BrowserImportPathContext,
  run: CommandRunner = runCommand,
): Promise<Set<string>> {
  const result = new Set<string>();
  if (context.platform === "darwin") {
    for (const root of [
      join(context.home, "Applications"),
      "/Applications",
      "/System/Applications",
    ]) {
      for (const entry of await entries(root, ".app")) {
        const plist = await run("/usr/bin/plutil", [
          "-convert",
          "json",
          "-o",
          "-",
          join(root, entry, "Contents", "Info.plist"),
        ]);
        if (!plist.ok) continue;
        const names = parseMacBrowserApplication(
          plist.stdout,
          basename(entry, ".app"),
        );
        for (const name of names ?? []) result.add(name);
      }
    }
  } else if (context.platform === "linux") {
    const seen = new Set<string>();
    for (const root of [
      join(context.home, ".local", "share", "applications"),
      join(
        context.home,
        ".local",
        "share",
        "flatpak",
        "exports",
        "share",
        "applications",
      ),
      "/usr/local/share/applications",
      "/usr/share/applications",
      "/var/lib/flatpak/exports/share/applications",
      "/var/lib/snapd/desktop/applications",
    ]) {
      for (const entry of await entries(root, ".desktop")) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        try {
          const path = join(root, entry);
          if ((await stat(path)).size > 1024 * 1024) continue;
          const names = parseLinuxBrowserApplication(
            await readFile(path, "utf8"),
            basename(entry, ".desktop"),
          );
          for (const name of names ?? []) result.add(name);
        } catch {
          continue;
        }
      }
    }
  }
  return result;
}
