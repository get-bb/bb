import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { create, extract } from "tar";
import { z } from "zod";

export async function buildBundledPlugins(
  packageRoot: string,
  repoRoot: string,
): Promise<void> {
  const { dependencies } = z
    .object({ dependencies: z.record(z.string(), z.string()) })
    .parse(
      JSON.parse(
        await readFile(path.join(packageRoot, "package.json"), "utf8"),
      ),
    );
  const expectedDependencies = new Set(
    Object.keys(dependencies).filter((name) => name.startsWith("bb-plugin-")),
  );
  const marketplacePath = path.join(
    repoRoot,
    "apps/server/src/generated/bb-official-marketplace/marketplace.json",
  );
  const marketplace = z
    .object({
      plugins: z.array(
        z.object({
          source: z.object({
            bundled: z.object({
              plugin: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            }),
          }),
        }),
      ),
    })
    .parse(JSON.parse(await readFile(marketplacePath, "utf8")));
  const staging = await mkdtemp(path.join(tmpdir(), "bb-bundled-plugins-"));
  try {
    for (const entry of marketplace.plugins) {
      const pluginName = entry.source.bundled.plugin;
      const source = path.join(repoRoot, "plugins", pluginName);
      const { name } = z
        .object({ name: z.string() })
        .parse(
          JSON.parse(await readFile(path.join(source, "package.json"), "utf8")),
        );
      if (!expectedDependencies.delete(name))
        throw new Error(
          `Bundled plugin ${pluginName} is missing from package dependencies`,
        );
      const target = path.join(staging, pluginName);
      await mkdir(target, { recursive: true });
      await extract({
        file: path.join(source, "dist/bundled-plugin.tgz"),
        cwd: target,
        strict: true,
      });
    }
    if (expectedDependencies.size > 0)
      throw new Error(
        `Unregistered bundled plugin dependencies: ${[...expectedDependencies].join(", ")}`,
      );
    await cp(marketplacePath, path.join(staging, "marketplace.json"));
    await mkdir(path.join(packageRoot, "dist"), { recursive: true });
    await create(
      {
        file: path.join(packageRoot, "dist/bundled-plugins.tgz"),
        cwd: staging,
        portable: true,
        gzip: { level: 1 },
        mtime: new Date(0),
      },
      ["."],
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const packageRoot = path.resolve(import.meta.dirname, "..");
  await buildBundledPlugins(packageRoot, path.resolve(packageRoot, "../.."));
}
