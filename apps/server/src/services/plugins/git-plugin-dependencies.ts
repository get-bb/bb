import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runInstallCommand } from "./install-sources.js";

const INSTALLED_DEPENDENCY_FIELDS = ["dependencies", "peerDependencies"];

async function declaresInstalledDependencies(
  rootDir: string,
): Promise<boolean> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    );
  } catch {
    return true;
  }
  if (typeof manifest !== "object" || manifest === null) return true;
  return INSTALLED_DEPENDENCY_FIELDS.some((field) => {
    const value: unknown = Reflect.get(manifest, field);
    if (value === undefined) return false;
    if (typeof value !== "object" || value === null) return true;
    return Object.keys(value).length > 0;
  });
}

export async function installGitDependencies(rootDir: string): Promise<void> {
  for (const name of [".npmrc", ".yarnrc", ".yarnrc.yml"]) {
    await rm(join(rootDir, name), { force: true });
  }
  if (!(await declaresInstalledDependencies(rootDir))) return;
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
