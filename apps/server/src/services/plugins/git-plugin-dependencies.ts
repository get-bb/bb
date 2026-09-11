import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runInstallCommand } from "./install-sources.js";

export async function installGitDependencies(rootDir: string): Promise<void> {
  for (const name of [".npmrc", ".yarnrc", ".yarnrc.yml"]) {
    await rm(join(rootDir, name), { force: true });
  }
  await runInstallCommand("npm", [
    "install",
    "--prefix",
    rootDir,
    "--ignore-scripts",
    "--omit=dev",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
  ]);
}
