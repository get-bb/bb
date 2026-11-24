import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

export interface FakeStorageDir {
  openDatabase(): Database.Database;
  filesDirectory(): string;
  remove(): void;
}

interface HostDirRoot {
  path: string;
  removers: Set<() => void>;
}

interface HostDirRootState {
  root: HostDirRoot | null;
}

const ROOT_KEY = Symbol.for("bb.plugin-sdk.fake-plugin-host-root");

type RootHolder = { [ROOT_KEY]?: HostDirRootState };

function removeDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {}
}

function rootState(): HostDirRootState {
  const holder = globalThis as RootHolder;
  const existing = holder[ROOT_KEY];
  if (existing !== undefined) return existing;
  const state: HostDirRootState = { root: null };
  holder[ROOT_KEY] = state;
  process.once("exit", () => {
    const root = state.root;
    if (root === null) return;
    state.root = null;
    for (const remove of [...root.removers]) {
      try {
        remove();
      } catch {}
    }
    removeDir(root.path);
  });
  return state;
}

function acquireRoot(): HostDirRoot {
  const state = rootState();
  if (state.root !== null) return state.root;
  const root: HostDirRoot = {
    path: mkdtempSync(
      join(resolve(tmpdir()), `bb-fake-plugin-host-${process.pid}-`),
    ),
    removers: new Set(),
  };
  state.root = root;
  return root;
}

function releaseRoot(root: HostDirRoot, remove: () => void): void {
  root.removers.delete(remove);
  if (root.removers.size > 0) return;
  const state = rootState();
  if (state.root === root) state.root = null;
  removeDir(root.path);
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
    if (path !== null) rmSync(path, { recursive: true, force: true });
    const owner = root;
    path = null;
    root = null;
    if (owner !== null) releaseRoot(owner, remove);
  };
  const hostDir = (): string => {
    if (path === null) {
      root = acquireRoot();
      path = mkdtempSync(join(root.path, "host-"));
      root.removers.add(remove);
    }
    return path;
  };
  return {
    openDatabase() {
      const dir = hostDir();
      for (const database of databases) {
        if (!database.open) databases.delete(database);
      }
      const database = new Database(join(dir, "data.db"));
      databases.add(database);
      return database;
    },
    filesDirectory() {
      const directory = join(hostDir(), "files");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      return directory;
    },
    remove,
  };
}
