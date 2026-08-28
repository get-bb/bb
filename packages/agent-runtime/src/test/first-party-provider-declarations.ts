import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { pluginPackageJsonSchema } from "@bb/domain";
import type { BbPluginApi, PluginSettingValue } from "@get-bb/plugin-sdk";
import type { NormalizedPluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

export function firstPartyPluginRootDir(pluginId: string): string {
  return fileURLToPath(
    new URL(`../../../../plugins/${pluginId}`, import.meta.url),
  );
}

async function declaredIconNames(pluginId: string): Promise<string[]> {
  const manifest = pluginPackageJsonSchema.parse(
    JSON.parse(
      await readFile(
        path.join(firstPartyPluginRootDir(pluginId), "package.json"),
        "utf8",
      ),
    ),
  );
  return Object.keys(manifest.bb.branding.experimental_icons ?? {});
}

const pluginServerModuleSchema = z
  .object({
    default: z.function({ input: [z.custom<BbPluginApi>()] }).optional(),
  })
  .passthrough();

export interface CaptureFirstPartyProviderDeclarationsOptions {
  settings?: Record<string, PluginSettingValue>;
}

export async function captureFirstPartyProviderDeclarations(
  pluginId: string,
  options: CaptureFirstPartyProviderDeclarationsOptions = {},
): Promise<NormalizedPluginProviderDeclaration[]> {
  const moduleUrl = new URL(
    `../../../../plugins/${pluginId}/server.ts`,
    import.meta.url,
  ).href;
  const loaded = await import(/* @vite-ignore */ moduleUrl);
  const parsedModule = pluginServerModuleSchema.safeParse(loaded);
  if (!parsedModule.success || parsedModule.data.default === undefined) {
    throw new Error(`${pluginId} has no default plugin export`);
  }
  const entry = parsedModule.data.default;
  const hostOptions: Parameters<typeof createFakePluginHost>[0] = {
    pluginId,
    dataDir: firstPartyPluginRootDir("__no-such-data-dir__"),
    experimental_declaredIconNames: await declaredIconNames(pluginId),
  };
  if (options.settings !== undefined) {
    hostOptions.settings = options.settings;
  }
  const host = createFakePluginHost({
    ...hostOptions,
  });
  try {
    await entry(host.bb);
    const captured = [...host.harness.registrations.providerRegistrations];
    if (captured.length === 0) {
      throw new Error(`${pluginId} registered no provider declaration`);
    }
    return captured;
  } finally {
    await host.harness.dispose();
  }
}
