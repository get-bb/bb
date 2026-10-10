import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PackageAssets } from "./app-package.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export const ASSET_MIGRATIONS = [
  "CREATE TABLE asset_blobs (sha256 TEXT PRIMARY KEY, data TEXT NOT NULL)",
  "CREATE TABLE answer_assets (answer_id TEXT NOT NULL, thread_id TEXT NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY (answer_id, thread_id))",
  "CREATE TABLE answer_asset_files (answer_id TEXT NOT NULL, thread_id TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY (answer_id, thread_id, sha256))",
  "CREATE INDEX answer_asset_files_sha ON answer_asset_files(sha256)",
  "CREATE INDEX answer_assets_thread ON answer_assets(thread_id)",
];

type Manifest = {
  imports: Record<string, string>;
  files: Record<string, Omit<PackageAssets["files"][string], "data">>;
};

export function createAssetStore(db: Db) {
  const collect = () =>
    db
      .prepare(
        "DELETE FROM asset_blobs WHERE NOT EXISTS (SELECT 1 FROM answer_asset_files f WHERE f.sha256 = asset_blobs.sha256)",
      )
      .run();
  return {
    save(answerId: string, threadId: string, assets: PackageAssets) {
      const manifest: Manifest = { imports: assets.imports, files: {} };
      for (const [name, file] of Object.entries(assets.files)) {
        const { data, ...meta } = file;
        manifest.files[name] = meta;
        db.prepare(
          "INSERT OR IGNORE INTO asset_blobs (sha256, data) VALUES (?, ?)",
        ).run(file.sha256, data);
        db.prepare(
          "INSERT OR IGNORE INTO answer_asset_files (answer_id, thread_id, sha256) VALUES (?, ?, ?)",
        ).run(answerId, threadId, file.sha256);
      }
      db.prepare(
        "INSERT OR REPLACE INTO answer_assets (answer_id, thread_id, manifest) VALUES (?, ?, ?)",
      ).run(answerId, threadId, JSON.stringify(manifest));
    },
    load(answerId: string, threadId: string): PackageAssets | null {
      const row = db
        .prepare(
          "SELECT manifest FROM answer_assets WHERE answer_id = ? AND thread_id = ?",
        )
        .get(answerId, threadId) as { manifest: string } | undefined;
      if (!row) return null;
      const manifest = JSON.parse(row.manifest) as Manifest;
      const files: PackageAssets["files"] = {};
      for (const [name, meta] of Object.entries(manifest.files)) {
        const blob = db
          .prepare("SELECT data FROM asset_blobs WHERE sha256 = ?")
          .get(meta.sha256) as { data: string } | undefined;
        if (!blob) return null;
        files[name] = { ...meta, data: blob.data };
      }
      return { imports: manifest.imports, files };
    },
    copy(fromThreadId: string, toThreadId: string, id: string | null) {
      db.prepare(
        "INSERT OR IGNORE INTO answer_assets (answer_id, thread_id, manifest) SELECT answer_id, ?, manifest FROM answer_assets WHERE thread_id = ? AND (? IS NULL OR answer_id = ?)",
      ).run(toThreadId, fromThreadId, id, id);
      db.prepare(
        "INSERT OR IGNORE INTO answer_asset_files (answer_id, thread_id, sha256) SELECT answer_id, ?, sha256 FROM answer_asset_files WHERE thread_id = ? AND (? IS NULL OR answer_id = ?)",
      ).run(toThreadId, fromThreadId, id, id);
    },
    remove(threadId: string, answerId: string | null) {
      db.prepare(
        "DELETE FROM answer_assets WHERE thread_id = ? AND (? IS NULL OR answer_id = ?)",
      ).run(threadId, answerId, answerId);
      db.prepare(
        "DELETE FROM answer_asset_files WHERE thread_id = ? AND (? IS NULL OR answer_id = ?)",
      ).run(threadId, answerId, answerId);
      collect();
    },
  };
}
export type AssetStore = ReturnType<typeof createAssetStore>;
