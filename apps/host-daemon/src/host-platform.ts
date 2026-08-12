import type { HostPlatform } from "@bb/host-daemon-contract";

export function resolveHostPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): HostPlatform {
  if (nodePlatform === "darwin") return "darwin";
  if (nodePlatform === "win32") return "win32";
  if (nodePlatform === "linux") {
    const isWsl = env.WSL_DISTRO_NAME != null || env.WSL_INTEROP != null;
    return isWsl ? "wsl" : "linux";
  }
  return "unknown";
}
