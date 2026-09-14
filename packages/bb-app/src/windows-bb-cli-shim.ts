import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BbAppStartContext } from "./launcher.js";

export function resolveBundledBbCliEntry(context: BbAppStartContext): string {
  return join(
    context.daemonBundleDir,
    process.platform === "win32" ? "bb.cmd" : "bb",
  );
}

export function ensureWindowsBbCliShim(context: BbAppStartContext): void {
  if (process.platform !== "win32") {
    return;
  }
  const bbEntry = join(context.daemonBundleDir, "bb");
  const shimPath = join(context.daemonBundleDir, "bb.cmd");
  const shimContents = `@echo off\r\n"${process.execPath}" "${bbEntry}" %*\r\n`;
  try {
    if (
      existsSync(shimPath) &&
      readFileSync(shimPath, "utf8") === shimContents
    ) {
      return;
    }
    writeFileSync(shimPath, shimContents);
  } catch (error) {
    process.stderr.write(
      `bb-app: could not write Windows bb CLI shim ${shimPath}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
}
