import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonValueSchema, type JsonObject, type JsonValue } from "@bb/domain";

interface PluginSdkDeclarations {
  root: string;
  app: string;
}

declare global {
  var __BB_PLUGIN_SDK_DTS_JSON__: string | undefined;
}

const ROOT_FILE = "bb-plugin-sdk.d.ts";
const APP_FILE = "bb-plugin-sdk-app.d.ts";
const BUNDLED_TYPES_RELATIVE = join("packages", "plugin-sdk", "bundled-types");

let cached: Promise<PluginSdkDeclarations> | null = null;

export function loadPluginSdkDeclarations(): Promise<PluginSdkDeclarations> {
  cached ??= loadUncached();
  return cached;
}

async function loadUncached(): Promise<PluginSdkDeclarations> {
  const inlinedDeclarations = globalThis.__BB_PLUGIN_SDK_DTS_JSON__;
  if (inlinedDeclarations !== undefined) {
    return parseDeclarations(inlinedDeclarations);
  }
  const typesDir = findWorkspaceBundledTypesDir();
  if (typesDir === null) {
    throw new Error(
      `Could not find ${BUNDLED_TYPES_RELATIVE} above ${moduleDir()}. ` +
        "Build the plugin SDK declarations first: " +
        "pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk",
    );
  }
  const [root, app] = await Promise.all([
    readFile(join(typesDir, ROOT_FILE), "utf8"),
    readFile(join(typesDir, APP_FILE), "utf8"),
  ]);
  return { root, app };
}

function parseDeclarations(json: string): PluginSdkDeclarations {
  const parsed: JsonValue = jsonValueSchema.parse(JSON.parse(json));
  if (!isJsonObject(parsed)) {
    throw new Error("Inlined plugin SDK declarations have an unexpected shape");
  }
  return {
    root: parseStringValue(parsed.root),
    app: parseStringValue(parsed.app),
  };
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function parseStringValue(value: JsonValue): string {
  if (value === undefined || value !== String(value)) {
    throw new Error("Inlined plugin SDK declarations have an unexpected shape");
  }
  return value;
}

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function findWorkspaceBundledTypesDir(): string | null {
  let dir = moduleDir();
  for (;;) {
    const candidate = join(dir, BUNDLED_TYPES_RELATIVE);
    if (existsSyncSafe(join(candidate, ROOT_FILE))) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

function existsSyncSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
