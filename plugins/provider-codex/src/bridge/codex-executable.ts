import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function codexNativeExecutablePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA ??
      path.win32.join(env.USERPROFILE ?? os.homedir(), "AppData", "Local");
    return path.win32.join(
      localAppData,
      "Programs",
      "OpenAI",
      "Codex",
      "bin",
      "codex.exe",
    );
  }
  return path.posix.join(env.HOME ?? os.homedir(), ".local", "bin", "codex");
}

function commandOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  const extensions =
    platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  return (env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .some((directory) =>
      extensions.some((extension) =>
        existsSync(path.join(directory, `${command}${extension}`)),
      ),
    );
}

export function resolveCodexCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (commandOnPath("codex", env, platform)) return "codex";
  const nativePath = codexNativeExecutablePath(env, platform);
  return existsSync(nativePath) ? nativePath : "codex";
}
