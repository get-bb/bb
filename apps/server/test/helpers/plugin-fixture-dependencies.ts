import { mkdir, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const testRequire = createRequire(import.meta.url);

export async function linkPluginFixtureDependency(
  rootDir: string,
  packageName: string,
): Promise<void> {
  const packageRoot = dirname(
    testRequire.resolve(`${packageName}/package.json`),
  );
  const linkPath = join(rootDir, "node_modules", ...packageName.split("/"));
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(packageRoot, linkPath, "dir");
}
