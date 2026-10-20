import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import {
  buildPluginHost,
  isIgnoredPluginDevPath,
  type PluginBuildToolchain,
} from "@bb/plugin-build";
import { validatePluginArtifactMeta } from "./app-bundle.js";

const hostBuildRecordSchema = z.object({
  rootDir: z.string(),
  bbVersion: z.string(),
  artifactDigest: z.string(),
  inputs: z.array(z.string()),
});

function hostBuildRecordPath(dataDir: string, pluginId: string): string {
  const pluginKey = createHash("sha256").update(pluginId).digest("hex");
  return join(dataDir, "plugins", "runtime", "host", pluginKey, "build.json");
}

export async function isMutableArtifactStale(
  rootDir: string,
  artifact: "app" | "host",
): Promise<boolean> {
  let artifactMtimeMs: number;
  try {
    artifactMtimeMs = (await stat(join(rootDir, "dist", `${artifact}.js`)))
      .mtimeMs;
  } catch {
    return true;
  }

  const pendingDirectories = [""];
  while (pendingDirectories.length > 0) {
    const relativeDirectory = pendingDirectories.pop();
    if (relativeDirectory === undefined) break;
    const directory = join(rootDir, relativeDirectory);
    let entries;
    try {
      const directoryStats = await stat(directory);
      if (directoryStats.mtimeMs > artifactMtimeMs) return true;
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return true;
    }

    for (const entry of entries) {
      const relativePath = join(relativeDirectory, entry.name);
      if (isIgnoredPluginDevPath(relativePath)) continue;
      try {
        const entryStats = await stat(join(rootDir, relativePath));
        if (entryStats.mtimeMs > artifactMtimeMs) return true;
      } catch {
        return true;
      }
      if (entry.isDirectory()) pendingDirectories.push(relativePath);
    }
  }
  return false;
}

export async function buildMutablePluginHost(args: {
  dataDir: string;
  pluginId: string;
  rootDir: string;
  bbVersion: string;
  toolchain: PluginBuildToolchain;
}): Promise<void> {
  const result = await buildPluginHost(
    args.rootDir,
    args.bbVersion,
    args.toolchain,
  );
  const recordPath = hostBuildRecordPath(args.dataDir, args.pluginId);
  await mkdir(dirname(recordPath), { recursive: true });
  const stagedPath = `${recordPath}.${randomUUID()}.tmp`;
  await writeFile(
    stagedPath,
    JSON.stringify({
      rootDir: args.rootDir,
      bbVersion: args.bbVersion,
      artifactDigest: result.artifactDigest,
      inputs: result.inputs,
    } satisfies z.infer<typeof hostBuildRecordSchema>),
  );
  await rename(stagedPath, recordPath);
}

export async function isMutablePluginHostReusable(args: {
  dataDir: string;
  pluginId: string;
  pluginVersion: string;
  rootDir: string;
  bbVersion: string;
}): Promise<boolean> {
  const distDir = join(args.rootDir, "dist");
  let record: z.infer<typeof hostBuildRecordSchema>;
  let rawMeta: string;
  let artifact: Buffer;
  let artifactMtimeMs: number;
  try {
    record = hostBuildRecordSchema.parse(
      JSON.parse(
        await readFile(
          hostBuildRecordPath(args.dataDir, args.pluginId),
          "utf8",
        ),
      ),
    );
    rawMeta = await readFile(join(distDir, "host.meta.json"), "utf8");
    artifactMtimeMs = (await stat(join(distDir, "host.js"))).mtimeMs;
    artifact = await readFile(join(distDir, "host.js"));
  } catch {
    return false;
  }
  if (
    record.rootDir !== args.rootDir ||
    record.bbVersion !== args.bbVersion ||
    validatePluginArtifactMeta({
      artifact: "host",
      raw: rawMeta,
      pluginId: args.pluginId,
      pluginVersion: args.pluginVersion,
    }) !== null
  ) {
    return false;
  }
  const meta = z
    .object({ sdkVersion: z.string(), artifactDigest: z.string() })
    .safeParse(JSON.parse(rawMeta));
  const digest = createHash("sha256").update(artifact).digest("hex");
  if (
    !meta.success ||
    meta.data.sdkVersion !== PLUGIN_SDK_VERSION ||
    meta.data.artifactDigest !== digest ||
    record.artifactDigest !== digest
  ) {
    return false;
  }
  for (const input of record.inputs) {
    try {
      const inputStats = await stat(input);
      if (Math.max(inputStats.mtimeMs, inputStats.ctimeMs) > artifactMtimeMs)
        return false;
    } catch {
      return false;
    }
  }
  return !(await isMutableArtifactStale(args.rootDir, "host"));
}
