import os from "node:os";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  discoverProviderCommands,
  type CommandScanRoot,
} from "../command-discovery.js";

export interface CommandRootResolution {
  /** Resolved workspace path, or null for an unprovisioned thread. */
  cwd: string | null;
  /** Claude user-home base (`os.homedir()`). */
  homeDir: string;
  /** Codex user-home base (`$CODEX_HOME` or `~/.codex`). */
  codexHome: string;
  providerId: string;
}

function resolveCodexHome(homeDir: string): string {
  return process.env.CODEX_HOME?.trim() || path.join(homeDir, ".codex");
}

/**
 * Build the ordered set of roots to scan for a provider. Project (cwd-dependent)
 * roots are skipped when `cwd` is null; user-home roots are always included.
 * Providers without a command surface (e.g. `pi`) yield an empty root set.
 */
export function resolveCommandScanRoots(
  resolution: CommandRootResolution,
): CommandScanRoot[] {
  const roots: CommandScanRoot[] = [];

  if (resolution.providerId === "claude-code") {
    if (resolution.cwd !== null) {
      roots.push({
        rootPath: path.join(resolution.cwd, ".claude", "skills"),
        shape: "skill",
        source: "skill",
        origin: "project",
      });
    }
    roots.push({
      rootPath: path.join(resolution.homeDir, ".claude", "skills"),
      shape: "skill",
      source: "skill",
      origin: "user",
    });
    if (resolution.cwd !== null) {
      roots.push({
        rootPath: path.join(resolution.cwd, ".claude", "commands"),
        shape: "command",
        source: "command",
        origin: "project",
      });
    }
    roots.push({
      rootPath: path.join(resolution.homeDir, ".claude", "commands"),
      shape: "command",
      source: "command",
      origin: "user",
    });
    return roots;
  }

  if (resolution.providerId === "codex") {
    if (resolution.cwd !== null) {
      roots.push({
        rootPath: path.join(resolution.cwd, ".codex", "skills"),
        shape: "skill",
        source: "skill",
        origin: "project",
      });
    }
    roots.push({
      rootPath: path.join(resolution.codexHome, "skills"),
      shape: "skill",
      source: "skill",
      origin: "user",
    });
    return roots;
  }

  return roots;
}

export async function listHostCommands(
  command: CommandOf<"host.list_commands">,
): Promise<HostDaemonOnlineRpcResult<"host.list_commands">> {
  if (command.cwd !== null && !path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError("invalid_path", "cwd must be absolute");
  }
  const homeDir = os.homedir();
  const roots = resolveCommandScanRoots({
    cwd: command.cwd,
    homeDir,
    codexHome: resolveCodexHome(homeDir),
    providerId: command.providerId,
  });
  const commands = await discoverProviderCommands({ roots });
  return { commands };
}
