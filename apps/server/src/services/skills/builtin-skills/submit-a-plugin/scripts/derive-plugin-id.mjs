#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { z } from "zod";

const pluginManifestSchema = z.object({ name: z.string() });

const manifestPath = process.argv[2];
if (manifestPath === undefined) {
  console.error("usage: derive-plugin-id.mjs <package.json>");
  process.exit(1);
}

let manifest;
try {
  const parsed = pluginManifestSchema.safeParse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (!parsed.success) {
    console.error("plugin manifest must contain a package name");
    process.exit(1);
  }
  manifest = parsed.data;
} catch (error) {
  console.error(
    `cannot read plugin manifest: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const packageName = manifest.name;
const base = packageName.includes("/")
  ? (packageName.split("/").at(-1) ?? packageName)
  : packageName;
const pluginId = base
  .replace(/^bb-plugin-/, "")
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-")
  .replace(/^-+|-+$/g, "");

if (pluginId.length === 0) {
  console.error(`cannot derive a plugin id from package name "${packageName}"`);
  process.exit(1);
}

process.stdout.write(`${pluginId}\n`);
