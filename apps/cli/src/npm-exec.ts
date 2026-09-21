import { resolveBundledNpmCli } from "@bb/plugin-build";

export interface NpmExecInvocation {
  command: string;
  prefixArgs: string[];
}

// bb-fork(windows): npm is npm.cmd on Windows, which execFile cannot spawn;
// run the bundled npm-cli.js through node instead.
export function npmExecInvocation(): NpmExecInvocation {
  if (process.platform !== "win32") {
    return { command: "npm", prefixArgs: [] };
  }
  return { command: process.execPath, prefixArgs: [resolveBundledNpmCli()] };
}
