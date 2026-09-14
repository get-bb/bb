import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const FORK_CATALOG_FIELDS_FILENAME = "bb-fork.json";

export async function readMergedCatalogFields(
  repositoryRoot: string,
): Promise<unknown> {
  const official: unknown = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "plugins", "bb-official.json"),
      "utf8",
    ),
  );
  const forkPath = path.join(
    repositoryRoot,
    "plugins",
    FORK_CATALOG_FIELDS_FILENAME,
  );
  if (!existsSync(forkPath)) {
    return official;
  }
  const fork: unknown = JSON.parse(await readFile(forkPath, "utf8"));
  return {
    ...(official as Record<string, unknown>),
    ...(fork as Record<string, unknown>),
  };
}
