import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { BbDesktopCliCommandStatus } from "@bb/desktop-contract";
import { resolveHomeCliBinDir } from "./cli-link.js";

/**
 * What the settings row reports.
 *
 * The PATH read needs no new probe: main.ts already calls
 * ensurePackagedUserShellPath at startup on packaged builds, which runs the
 * login shell and assigns the result to process.env.PATH. By the time an IPC
 * handler runs, process.env.PATH is the user's login PATH.
 */

interface ResolveCliCommandStatusArgs {
  commandName: string;
  homeDir: string;
  path: string;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCliCommandStatus(
  args: ResolveCliCommandStatusArgs,
): BbDesktopCliCommandStatus {
  const binDir = resolveHomeCliBinDir({ homeDir: args.homeDir });
  const wrapperPath = join(binDir, args.commandName);
  // An empty PATH entry means the current directory, not our bin dir.
  const entries = args.path
    .split(delimiter)
    .filter((entry) => entry.length > 0);
  const matches = entries
    .map((entry) => join(entry, args.commandName))
    .filter(isExecutableFile);

  return {
    binDir,
    commandName: args.commandName,
    matches,
    onPath: entries.includes(binDir),
    ownEntryWins: matches[0] === wrapperPath,
    wrapperInstalled: isExecutableFile(wrapperPath),
  };
}
