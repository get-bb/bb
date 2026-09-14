import { resolvePluginNpmCli } from "@bb/plugin-build";

export interface NpmExecInvocation {
  command: string;
  prefixArgs: string[];
}

export function npmExecInvocation(): NpmExecInvocation {
  if (process.platform !== "win32") {
    return { command: "npm", prefixArgs: [] };
  }
  return { command: process.execPath, prefixArgs: [resolvePluginNpmCli()] };
}
