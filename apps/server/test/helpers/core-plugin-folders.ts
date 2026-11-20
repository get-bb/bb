import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { derivePluginId } from "@bb/domain";

function derivedIdOrNull(packageName: string): string | null {
  try {
    return derivePluginId(packageName);
  } catch {
    return null;
  }
}

export async function expectCorePluginFoldersUnclaimable(
  dataDir: string,
  installedPluginIds: readonly string[],
): Promise<void> {
  const entries = await readdir(join(dataDir, "plugins"));
  const coreFolders = entries.filter(
    (name) => !installedPluginIds.includes(name),
  );
  expect(coreFolders).not.toEqual([]);
  for (const name of coreFolders) {
    expect(
      [derivedIdOrNull(name), derivedIdOrNull(`bb-plugin-${name}`)],
      `a plugin can claim core's plugins/${name} folder`,
    ).not.toContain(name);
  }
}
