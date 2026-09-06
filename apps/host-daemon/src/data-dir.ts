import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { resolveRuntimeMode } from "@bb/config/runtime";

interface ResolveHostDaemonProdDataDirArgs {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
}

interface ResolveHostDaemonDataDirOverrideArgs {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export function resolveHostDaemonProdDataDir(
  args: ResolveHostDaemonProdDataDirArgs,
): string {
  if (args.platform === "win32") {
    const appData = args.env.APPDATA?.trim();
    if (appData) {
      return win32.join(appData, "bb");
    }
    return win32.join(args.homeDir, "bb");
  }
  return posix.join(args.homeDir, ".bb");
}

export function resolveHostDaemonDataDirOverride(
  args: ResolveHostDaemonDataDirOverrideArgs = {},
): string | undefined {
  const platform = args.platform ?? process.platform;
  const env = args.env ?? process.env;
  if (platform !== "win32") {
    return undefined;
  }
  if (env.BB_DATA_DIR !== undefined) {
    return undefined;
  }
  if (resolveRuntimeMode(env.NODE_ENV) !== "prod") {
    return undefined;
  }
  return resolveHostDaemonProdDataDir({
    env,
    homeDir: args.homeDir ?? homedir(),
    platform,
  });
}
