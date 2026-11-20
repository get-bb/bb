import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

export interface FakeStorageDir {
  openDatabase(): Database.Database;
  remove(): void;
}

interface HostDirRoot {
  path: string;
  removers: Set<() => void>;
}

const ROOT_KEY = Symbol.for("bb.plugin-sdk.fake-plugin-host-root");

type RootHolder = { [ROOT_KEY]?: HostDirRoot };

function hostDirRoot(): HostDirRoot {
  const holder = globalThis as RootHolder;
  const existing = holder[ROOT_KEY];
  if (existing !== undefined) return existing;
  const root: HostDirRoot = {
    path: mkdtempSync(join(tmpdir(), `bb-fake-plugin-host-${process.pid}-`)),
    removers: new Set(),
  };
  holder[ROOT_KEY] = root;
  process.once("exit", () => {
    if (holder[ROOT_KEY] === root) delete holder[ROOT_KEY];
    for (const remove of [...root.removers]) {
      try {
        remove();
      } catch {}
    }
    try {
      rmSync(root.path, { recursive: true, force: true });
    } catch {}
  });
  return root;
}

export function createFakeStorageDir(): FakeStorageDir {
  let path: string | null = null;
  let root: HostDirRoot | null = null;
  const databases = new Set<Database.Database>();
  const remove = (): void => {
    for (const database of databases) {
      try {
        if (database.open) database.close();
      } catch {}
    }
    databases.clear();
    root?.removers.delete(remove);
    root = null;
    if (path === null) return;
    const dirPath = path;
    path = null;
    rmSync(dirPath, { recursive: true, force: true });
  };
  return {
    openDatabase() {
      if (path === null) {
        root = hostDirRoot();
        path = mkdtempSync(join(root.path, "host-"));
        root.removers.add(remove);
      }
      const database = new Database(join(path, "data.db"));
      databases.add(database);
      return database;
    },
    remove,
  };
}
