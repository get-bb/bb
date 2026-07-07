import { readFile, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import {
  connectCredentialSchema,
  type CredentialStore,
} from "./credential.js";

const LEGACY_MIGRATION_DONE_KEY = "legacy-migration-done";

/**
 * Recover the BB data dir from the plugin's own sqlite handle: the host
 * vends it at <dataDir>/plugins/<pluginId>/data.db. Returns null when the
 * handle's file does not follow that layout (isolated test harnesses put it
 * in a temp dir) — the caller then skips the legacy import.
 */
export function dataDirFromDb(
  db: Database.Database,
  pluginId: string,
): string | null {
  const row = db
    .prepare(`PRAGMA database_list`)
    .all()
    .find((entry: unknown) => (entry as { name?: unknown }).name === "main");
  const file = (row as { file?: unknown } | undefined)?.file;
  if (typeof file !== "string" || file.length === 0) return null;
  const pluginDir = dirname(file);
  const pluginsDir = dirname(pluginDir);
  if (basename(pluginDir) !== pluginId || basename(pluginsDir) !== "plugins") {
    return null;
  }
  return dirname(pluginsDir);
}

/**
 * One-shot import of the kernel-era credential file (<dataDir>/connect.json)
 * into plugin kv, so a bb that was paired before the upgrade stays paired
 * with zero user action. The file is renamed to connect.json.migrated either
 * way (a corrupt file is moved aside too, so it is never re-parsed); a
 * missing file just marks the migration done. Returns true when a credential
 * was imported.
 */
export async function importLegacyConnectCredential(args: {
  kv: Pick<BbPluginApi["storage"]["kv"], "get" | "set">;
  store: CredentialStore;
  dataDir: string;
  log: Pick<BbPluginApi["log"], "info" | "warn">;
}): Promise<boolean> {
  const done = await args.kv.get<boolean>(LEGACY_MIGRATION_DONE_KEY);
  if (done === true) return false;

  const legacyPath = join(args.dataDir, "connect.json");
  let raw: string | null = null;
  try {
    raw = await readFile(legacyPath, "utf8");
  } catch {
    // No legacy file — a fresh install or an already-migrated data dir.
    await args.kv.set(LEGACY_MIGRATION_DONE_KEY, true);
    return false;
  }

  let imported = false;
  try {
    const parsed = connectCredentialSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      if ((await args.store.read()) === null) {
        await args.store.write(parsed.data);
        imported = true;
      }
    } else {
      args.log.warn(
        `legacy connect.json does not look like a credential; skipping import`,
      );
    }
  } catch {
    args.log.warn(`legacy connect.json is not valid JSON; skipping import`);
  }

  try {
    await rename(legacyPath, `${legacyPath}.migrated`);
  } catch (error) {
    args.log.warn(
      `failed to rename legacy connect.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  await args.kv.set(LEGACY_MIGRATION_DONE_KEY, true);
  if (imported) {
    args.log.info(
      "imported the legacy connect credential from connect.json into plugin storage",
    );
  }
  return imported;
}
