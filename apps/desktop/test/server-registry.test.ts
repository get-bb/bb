import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_SERVER_ID,
  BUILTIN_SERVER_NAME,
  connectServerId,
  createServerRegistry,
  SERVER_REGISTRY_FILE_NAME,
} from "../src/server-registry.js";

interface TempDir {
  path: string;
}

const tempDirs: TempDir[] = [];

async function createTempDir(): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), "bb-desktop-server-registry-"));
  const tempDir = { path };
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir !== undefined) {
      await rm(tempDir.path, { force: true, recursive: true });
    }
  }
});

describe("server registry", () => {
  it("loads defaults when the registry file is missing", async () => {
    const tempDir = await createTempDir();
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath: join(tempDir.path, SERVER_REGISTRY_FILE_NAME),
    });

    const snapshot = await registry.load();

    expect(snapshot.autoConnectToLocalServer).toBe(true);
    expect(snapshot.servers).toEqual([
      {
        id: BUILTIN_SERVER_ID,
        name: BUILTIN_SERVER_NAME,
        source: "builtin",
        url: "http://127.0.0.1:38886",
      },
    ]);
  });

  it("falls back to defaults when the registry file is corrupt", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir.path, SERVER_REGISTRY_FILE_NAME);
    await writeFile(storagePath, "{not-json", "utf8");

    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:4000",
      storagePath,
    });
    const snapshot = await registry.load();

    expect(snapshot.autoConnectToLocalServer).toBe(true);
    expect(snapshot.servers).toHaveLength(1);
    expect(snapshot.servers[0]?.url).toBe("http://127.0.0.1:4000");
  });

  it("persists manual servers and auto-connect, but not the builtin URL", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir.path, SERVER_REGISTRY_FILE_NAME);
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath,
    });
    await registry.load();
    await registry.setAutoConnectToLocalServer(false);
    const added = await registry.add({
      name: "Staging",
      source: "manual",
      url: "https://staging.example.com",
    });

    const raw = await readFile(storagePath, "utf8");
    const persisted = JSON.parse(raw) as {
      autoConnectToLocalServer: boolean;
      servers: Array<{ id: string; name: string; source: string; url: string }>;
    };

    expect(persisted.autoConnectToLocalServer).toBe(false);
    expect(persisted.servers).toEqual([
      {
        id: added.id,
        name: "Staging",
        source: "manual",
        url: "https://staging.example.com",
      },
    ]);
    expect(raw).not.toContain("38886");
    expect(raw).not.toContain(BUILTIN_SERVER_ID);

    const reloaded = createServerRegistry({
      builtinUrl: "http://127.0.0.1:39999",
      storagePath,
    });
    const snapshot = await reloaded.load();
    expect(snapshot.autoConnectToLocalServer).toBe(false);
    expect(snapshot.servers[0]).toEqual({
      id: BUILTIN_SERVER_ID,
      name: BUILTIN_SERVER_NAME,
      source: "builtin",
      url: "http://127.0.0.1:39999",
    });
    expect(snapshot.servers[1]).toEqual(added);
  });

  it("never removes the builtin server", async () => {
    const tempDir = await createTempDir();
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath: join(tempDir.path, SERVER_REGISTRY_FILE_NAME),
    });
    await registry.load();

    expect(await registry.remove(BUILTIN_SERVER_ID)).toBe(false);
    expect(registry.list()).toHaveLength(1);
  });

  it("never renames the builtin server", async () => {
    const tempDir = await createTempDir();
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath: join(tempDir.path, SERVER_REGISTRY_FILE_NAME),
    });
    await registry.load();

    expect(await registry.rename(BUILTIN_SERVER_ID, "My Mac")).toBe(false);
    expect(registry.getServer(BUILTIN_SERVER_ID)?.name).toBe(BUILTIN_SERVER_NAME);
  });

  it("notifies listeners on mutations", async () => {
    const tempDir = await createTempDir();
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath: join(tempDir.path, SERVER_REGISTRY_FILE_NAME),
    });
    await registry.load();
    const snapshots: number[] = [];
    registry.onChange((snapshot) => {
      snapshots.push(snapshot.servers.length);
    });

    await registry.add({
      name: "Remote",
      source: "connect",
      url: "https://remote.example.com",
    });

    expect(snapshots).toEqual([2]);
  });

  it("hides connect entries from list() when showConnectServers is false", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir.path, SERVER_REGISTRY_FILE_NAME);
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath,
    });
    await registry.load();
    const connectId = connectServerId("laptop");
    await registry.upsert({
      id: connectId,
      name: "Laptop",
      source: "connect",
      url: "https://laptop.getbb.app",
    });
    await registry.add({
      name: "Manual",
      source: "manual",
      url: "https://manual.example.com",
    });

    expect(registry.list().map((s) => s.source).sort()).toEqual([
      "builtin",
      "connect",
      "manual",
    ]);

    await registry.setShowConnectServers(false);
    expect(registry.getShowConnectServers()).toBe(false);
    expect(registry.list().map((s) => s.source).sort()).toEqual([
      "builtin",
      "manual",
    ]);
    // Still in storage/snapshot for instant re-enable.
    expect(registry.snapshot().servers.some((s) => s.id === connectId)).toBe(
      true,
    );
    expect(registry.getServer(connectId)?.name).toBe("Laptop");

    const raw = await readFile(storagePath, "utf8");
    const persisted = JSON.parse(raw) as {
      showConnectServers: boolean;
      servers: Array<{ id: string; source: string }>;
    };
    expect(persisted.showConnectServers).toBe(false);
    expect(persisted.servers.some((s) => s.id === connectId)).toBe(true);

    await registry.setShowConnectServers(true);
    expect(registry.list().some((s) => s.id === connectId)).toBe(true);
  });

  it("defaults showConnectServers to true for older registry files", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir.path, SERVER_REGISTRY_FILE_NAME);
    await writeFile(
      storagePath,
      JSON.stringify({
        autoConnectToLocalServer: true,
        servers: [],
      }),
      "utf8",
    );
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath,
    });
    const snapshot = await registry.load();
    expect(snapshot.showConnectServers).toBe(true);
  });

  it("upserts by stable id and removeBySource keeps only listed ids", async () => {
    const tempDir = await createTempDir();
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath: join(tempDir.path, SERVER_REGISTRY_FILE_NAME),
    });
    await registry.load();

    const a = connectServerId("a");
    const b = connectServerId("b");
    await registry.upsert({
      id: a,
      name: "A",
      source: "connect",
      url: "https://a.getbb.app",
    });
    await registry.upsert({
      id: b,
      name: "B",
      source: "connect",
      url: "https://b.getbb.app",
    });
    await registry.upsert({
      id: a,
      name: "A2",
      source: "connect",
      url: "https://a2.getbb.app",
    });

    expect(registry.getServer(a)).toMatchObject({
      name: "A2",
      url: "https://a2.getbb.app",
    });

    const removed = await registry.removeBySource("connect", new Set([a]));
    expect(removed).toEqual([b]);
    expect(registry.getServer(b)).toBeNull();
    expect(registry.getServer(a)).not.toBeNull();
  });

  it("persists tile styles (including builtin), skips no-ops, and cleans up on remove", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir.path, SERVER_REGISTRY_FILE_NAME);
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath,
    });
    await registry.load();

    const notifications: number[] = [];
    registry.onChange(() => {
      notifications.push(Object.keys(registry.snapshot().tileStyles).length);
    });

    await registry.setTileStyle(BUILTIN_SERVER_ID, {
      icon: "Cloud",
      color: "blue",
    });
    expect(registry.getTileStyle(BUILTIN_SERVER_ID)).toEqual({
      icon: "Cloud",
      color: "blue",
    });
    expect(notifications).toEqual([1]);

    // Unchanged style is a no-op (no second notify).
    await registry.setTileStyle(BUILTIN_SERVER_ID, {
      icon: "Cloud",
      color: "blue",
    });
    expect(notifications).toEqual([1]);

    const manual = await registry.add({
      name: "Staging",
      source: "manual",
      url: "https://staging.example.com",
    });
    await registry.setTileStyle(manual.id, {
      icon: "Server",
      color: "red",
    });
    expect(registry.getTileStyle(manual.id)).toEqual({
      icon: "Server",
      color: "red",
    });

    const raw = await readFile(storagePath, "utf8");
    const persisted = JSON.parse(raw) as {
      tileStyles: Record<string, { icon: string | null; color: string | null }>;
    };
    // Builtin row is not persisted, but its style is (keyed by builtin id).
    expect(persisted.tileStyles[BUILTIN_SERVER_ID]).toEqual({
      icon: "Cloud",
      color: "blue",
    });
    expect(persisted.tileStyles[manual.id]).toEqual({
      icon: "Server",
      color: "red",
    });

    expect(await registry.remove(manual.id)).toBe(true);
    expect(registry.getTileStyle(manual.id)).toEqual({
      icon: null,
      color: null,
    });
    expect(manual.id in registry.snapshot().tileStyles).toBe(false);
    // Builtin style survives manual removal.
    expect(registry.getTileStyle(BUILTIN_SERVER_ID)).toEqual({
      icon: "Cloud",
      color: "blue",
    });

    // Clearing both fields drops the overlay entry.
    await registry.setTileStyle(BUILTIN_SERVER_ID, {
      icon: null,
      color: null,
    });
    expect(BUILTIN_SERVER_ID in registry.snapshot().tileStyles).toBe(false);

    const reloaded = createServerRegistry({
      builtinUrl: "http://127.0.0.1:39999",
      storagePath,
    });
    const snapshot = await reloaded.load();
    // After clear, no styles remain.
    expect(snapshot.tileStyles).toEqual({});
  });

  it("defaults tileStyles to {} for older registry files", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir.path, SERVER_REGISTRY_FILE_NAME);
    await writeFile(
      storagePath,
      JSON.stringify({
        autoConnectToLocalServer: true,
        servers: [],
      }),
      "utf8",
    );
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath,
    });
    const snapshot = await registry.load();
    expect(snapshot.tileStyles).toEqual({});
  });

  it("removeBySource deletes styles of removed connect ids", async () => {
    const tempDir = await createTempDir();
    const registry = createServerRegistry({
      builtinUrl: "http://127.0.0.1:38886",
      storagePath: join(tempDir.path, SERVER_REGISTRY_FILE_NAME),
    });
    await registry.load();

    const keep = connectServerId("keep");
    const drop = connectServerId("drop");
    await registry.upsert({
      id: keep,
      name: "Keep",
      source: "connect",
      url: "https://keep.getbb.app",
    });
    await registry.upsert({
      id: drop,
      name: "Drop",
      source: "connect",
      url: "https://drop.getbb.app",
    });
    await registry.setTileStyle(keep, { icon: "Cloud", color: "green" });
    await registry.setTileStyle(drop, { icon: "Server", color: "red" });

    const removed = await registry.removeBySource("connect", new Set([keep]));
    expect(removed).toEqual([drop]);
    expect(registry.getTileStyle(keep)).toEqual({
      icon: "Cloud",
      color: "green",
    });
    expect(drop in registry.snapshot().tileStyles).toBe(false);
  });
});
