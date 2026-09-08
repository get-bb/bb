import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { create, extract } from "tar";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const { dependencies } = z
  .object({ dependencies: z.record(z.string(), z.string()) })
  .parse(
    JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")),
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
    const plugin = { name: entry.source.bundled.plugin };
    const source = path.join(repoRoot, "plugins", plugin.name);
    const { name } = z
      .object({ name: z.string() })
      .parse(
        JSON.parse(await readFile(path.join(source, "package.json"), "utf8")),
      );
    if (!expectedDependencies.delete(name))
      throw new Error(
        `Bundled plugin ${plugin.name} is missing from package dependencies`,
      );
    const target = path.join(staging, plugin.name);
    await mkdir(target, { recursive: true });
    await extract({
      file: path.join(source, "dist/bundled-plugin.tar"),
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
      file: path.join(packageRoot, "dist/bundled-plugins.tar"),
      cwd: staging,
      portable: true,
      mtime: new Date(0),
    },
    ["."],
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
