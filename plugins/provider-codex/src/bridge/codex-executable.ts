import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function codexNativeExecutablePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.CODEX_INSTALL_DIR) {
    return (platform === "win32" ? path.win32 : path.posix).join(
      env.CODEX_INSTALL_DIR,
      platform === "win32" ? "codex.exe" : "codex",
    );
  }
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

function executableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | null {
  const extensions =
    platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  const paths = platform === "win32" ? path.win32 : path.posix;
  for (const directory of (env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)) {
    for (const extension of extensions) {
      const executable = paths.resolve(directory, `${command}${extension}`);
      if (existsSync(executable)) return executable;
    }
  }
  return null;
}

export function resolveCodexCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const onPath = executableOnPath("codex", env, platform);
  if (onPath !== null) return onPath;
  const nativePath = codexNativeExecutablePath(env, platform);
  return existsSync(nativePath) ? nativePath : "codex";
}
