import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sanitizeInheritedChildProcessEnv } from "@get-bb/plugin-sdk/provider-bridge";

const execFileAsync = promisify(execFile);

export async function resolveNativeApplicationIconDataUrl(
  bundleId: string,
): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const options = {
    timeout: 1_500,
    env: sanitizeInheritedChildProcessEnv({ env: process.env }),
  };
  let tempDirectory: string | null = null;
  try {
    const application = await execFileAsync(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        'ObjC.import("AppKit"); function run(argv) { const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(argv[0]); return url.isNil() ? "" : ObjC.unwrap(url.path); }',
        bundleId,
      ],
      options,
    );
    const appPath = application.stdout.trim();
    if (!path.isAbsolute(appPath) || !appPath.endsWith(".app")) return null;
    const icon = await execFileAsync(
      "/usr/bin/plutil",
      [
        "-extract",
        "CFBundleIconFile",
        "raw",
        "-o",
        "-",
        path.join(appPath, "Contents", "Info.plist"),
      ],
      options,
    );
    const iconFile = icon.stdout.trim();
    if (!iconFile || path.basename(iconFile) !== iconFile) return null;
    const iconFileName =
      path.extname(iconFile) === "" ? `${iconFile}.icns` : iconFile;
    tempDirectory = await mkdtemp(path.join(tmpdir(), "bb-codex-app-icon-"));
    await execFileAsync(
      "/usr/bin/qlmanage",
      [
        "-t",
        "-s",
        "32",
        "-o",
        tempDirectory,
        path.join(appPath, "Contents", "Resources", iconFileName),
      ],
      options,
    );
    const iconBytes = await readFile(
      path.join(tempDirectory, `${iconFileName}.png`),
    );
    const dataUrl = `data:image/png;base64,${iconBytes.toString("base64")}`;
    return dataUrl.length > 200_000 ? null : dataUrl;
  } catch {
    return null;
  } finally {
    if (tempDirectory !== null)
      await rm(tempDirectory, { force: true, recursive: true }).catch(() => {});
  }
}
