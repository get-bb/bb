import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_SERVER_ID,
  BUILTIN_SERVER_NAME,
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
});
