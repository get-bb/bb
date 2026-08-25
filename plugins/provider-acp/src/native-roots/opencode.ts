/**
 * opencode's host-local skill roots: its config directory follows
 * `$XDG_CONFIG_HOME`, and `$OPENCODE_CONFIG_DIR` names a second one. The
 * workspace-relative roots are declared statically.
 */

import path from "node:path";
import type { AcpNativeRootsEnvironment, AcpNativeRootsResolver } from "./resolver.js";
import { resolveStoredPath, skillsRoot } from "./shared.js";

/** `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`. */
export function resolveOpenCodeConfigDir(
  homeDir: string,
  env: AcpNativeRootsEnvironment,
): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  return xdgConfigHome
    ? path.join(resolveStoredPath(homeDir, xdgConfigHome), "opencode")
    : path.join(homeDir, ".config", "opencode");
}

export const resolveOpenCodeNativeRoots: AcpNativeRootsResolver = async (
  args,
) => {
  const customDir = args.env.OPENCODE_CONFIG_DIR?.trim();
  return {
    skills: [
      skillsRoot({
        origin: "user",
        path: path.join(resolveOpenCodeConfigDir(args.homeDir, args.env), "skills"),
        recursive: false,
      }),
      ...(customDir
        ? [
            skillsRoot({
              origin: "user",
              path: path.join(resolveStoredPath(args.homeDir, customDir), "skills"),
              recursive: false,
            }),
          ]
        : []),
    ],
  };
};
