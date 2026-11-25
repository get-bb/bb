import { join } from "node:path";

export type PluginDirectoryPart = "data.db" | "logs" | "secrets" | "files";

export function pluginDirectory(
  dataDir: string,
  pluginId: string,
  part: PluginDirectoryPart,
): string {
  return join(dataDir, "plugins", pluginId, part);
}
