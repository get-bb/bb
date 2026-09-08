import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { create } from "tar";
import { z } from "zod";
import { copyBuiltinPlugin } from "./copy-builtin-plugin.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error("Missing plugin source directory");
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const { version: bbVersion } = z
  .object({ version: z.string().min(1) })
  .parse(
    JSON.parse(
      await readFile(
        path.join(repoRoot, "packages/bb-app/package.json"),
        "utf8",
      ),
    ),
  );
const staging = await mkdtemp(path.join(tmpdir(), "bb-bundled-plugin-"));
try {
  await rm(path.join(sourceRoot, "dist"), { recursive: true, force: true });
  const toolchain = await resolvePluginBuildToolchain(
    path.join(repoRoot, "node_modules/.bb-toolchain"),
  );
  await copyBuiltinPlugin({
    bbVersion,
    toolchain,
    name: "plugin",
    sourceRoot,
    targetRoot: staging,
  });
  await mkdir(path.join(sourceRoot, "dist"), { recursive: true });
  await create(
    {
      file: path.join(sourceRoot, "dist/bundled-plugin.tar"),
      cwd: path.join(staging, "plugin"),
      portable: true,
      mtime: new Date(0),
    },
    ["."],
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
