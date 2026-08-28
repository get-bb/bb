import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  experimental_resolveVendorPluginRoots,
  type ExperimentalVendorPlugin,
} from "@get-bb/plugin-sdk/host";
import { z } from "zod";
import type { AcpNativeRootsResolver } from "./resolver.js";
import { readJsonFile } from "./shared.js";

const cursorPluginPathsSchema = z.union([z.string(), z.array(z.string())]);

const cursorPluginManifestSchema = z
  .object({
    name: z.string().min(1),
    skills: cursorPluginPathsSchema.optional(),
    commands: cursorPluginPathsSchema.optional(),
  })
  .passthrough();

type CursorPluginManifest = z.infer<typeof cursorPluginManifestSchema>;

async function readCursorPluginManifest(
  pluginRootPath: string,
): Promise<CursorPluginManifest | null> {
  for (const relativePath of [
    path.join(".cursor-plugin", "plugin.json"),
    "plugin.json",
  ]) {
    const manifest = await readJsonFile(
      path.join(pluginRootPath, relativePath),
      cursorPluginManifestSchema,
    );
    if (manifest !== null) {
      return manifest;
    }
  }
  return null;
}

async function resolveLocalCursorPlugins(
  homeDir: string,
): Promise<ExperimentalVendorPlugin[]> {
  const localPluginsPath = path.join(homeDir, ".cursor", "plugins", "local");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(localPluginsPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const plugins: ExperimentalVendorPlugin[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const pluginRootPath = path.join(localPluginsPath, entry.name);
    const stat = await fs.stat(pluginRootPath).catch(() => null);
    if (stat === null || !stat.isDirectory()) {
      continue;
    }
    const manifest = await readCursorPluginManifest(pluginRootPath);
    if (manifest === null) {
      continue;
    }
    plugins.push({
      rootPath: pluginRootPath,
      name: manifest.name,
      origin: "user",
      ...(manifest.skills === undefined ? {} : { skills: manifest.skills }),
      ...(manifest.commands === undefined
        ? {}
        : { commands: manifest.commands }),
    });
  }
  return plugins;
}

export const resolveCursorNativeRoots: AcpNativeRootsResolver = async (args) =>
  experimental_resolveVendorPluginRoots({
    plugins: await resolveLocalCursorPlugins(args.homeDir),
    layout: "claude",
  });
