import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extract } from "tar";

export async function installBundledPlugins(
  archivePath: string,
  targetRoot: string,
): Promise<void> {
  await mkdir(path.dirname(targetRoot), { recursive: true });
  const staging = await mkdtemp(
    path.join(path.dirname(targetRoot), ".bundled-plugins-"),
  );
  try {
    await extract({ file: archivePath, cwd: staging, strict: true });
    await rm(targetRoot, { recursive: true, force: true });
    await rename(staging, targetRoot);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [flag, target, ...extra] = process.argv.slice(2);
  if (flag !== "--target" || !target || extra.length > 0)
    throw new Error("Usage: install.ts --target <directory>");
  await installBundledPlugins(
    path.resolve(import.meta.dirname, "../dist/bundled-plugins.tgz"),
    path.resolve(target),
  );
}
