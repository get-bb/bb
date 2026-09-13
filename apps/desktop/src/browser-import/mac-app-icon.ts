import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRegularFile } from "./sources.js";

export type CommandRunner = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; ok: boolean }>;

export const runCommand: CommandRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve({ stdout, ok: error === null }),
    );
  });

export function iconFileFromInfoPlist(json: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const plist = parsed as Record<string, unknown>;
  const candidates = [plist.CFBundleIconFile, plist.CFBundleIconName];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0 || trimmed.includes("/") || trimmed.includes(".."))
      continue;
    return trimmed.endsWith(".icns") ? trimmed : `${trimmed}.icns`;
  }
  return undefined;
}

export async function readMacAppIcon(
  appPath: string,
  size = 64,
  run: CommandRunner = runCommand,
): Promise<string | undefined> {
  const plistPath = join(appPath, "Contents", "Info.plist");
  const plist = await run("plutil", ["-convert", "json", "-o", "-", plistPath]);
  if (!plist.ok) return undefined;
  const iconFile = iconFileFromInfoPlist(plist.stdout);
  if (iconFile === undefined) return undefined;
  const icnsPath = join(appPath, "Contents", "Resources", iconFile);
  if (!(await isRegularFile(icnsPath))) return undefined;
  const directory = await mkdtemp(join(tmpdir(), "bb-app-icon-"));
  const pngPath = join(directory, "icon.png");
  try {
    const converted = await run("sips", [
      "-s",
      "format",
      "png",
      "--resampleHeightWidth",
      String(size),
      String(size),
      icnsPath,
      "--out",
      pngPath,
    ]);
    if (!converted.ok) return undefined;
    const png = await readFile(pngPath);
    if (png.length === 0) return undefined;
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
