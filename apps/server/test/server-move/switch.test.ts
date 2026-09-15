import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverMovedFileSchema } from "@bb/server-archive";
import { afterEach, describe, expect, it } from "vitest";
import {
  listOldCopyEntries,
  listServerMovedTargets,
  restoreOldServerDaemonConfig,
  writeOldServerDaemonConfig,
} from "../../src/services/server-move/switch.js";

const tempDirs: string[] = [];

async function makeDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-server-move-switch-"));
  tempDirs.push(dataDir);
  return dataDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("old server daemon config", () => {
  it("points the old machine's daemon at the new server and restores the original config", async () => {
    const dataDir = await makeDataDir();
    const path = join(dataDir, "config.json");
    const original = `${JSON.stringify(
      {
        config: { BB_LOG_LEVEL: "debug" },
        customModels: [{ providerId: "codex", model: "gpt-test" }],
        machineCredential: "stale",
        serverHeaders: { "x-stale": "1" },
        connectMachineId: "machine-1",
      },
      null,
      4,
    )}\n`;
    await writeFile(path, original);

    const backup = await writeOldServerDaemonConfig({
      dataDir,
      headers: { "x-bb-connect-machine": "bbcm_laptop" },
      serverUrl: "https://laptop.getbb.test",
    });

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      config: { BB_LOG_LEVEL: "debug" },
      customModels: [{ providerId: "codex", model: "gpt-test" }],
      connectMachineId: "machine-1",
      serverUrl: "https://laptop.getbb.test",
      serverHeaders: { "x-bb-connect-machine": "bbcm_laptop" },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await restoreOldServerDaemonConfig(backup);
    expect(await readFile(path, "utf8")).toBe(original);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("omits empty headers and removes a config it created", async () => {
    const dataDir = await makeDataDir();
    const path = join(dataDir, "config.json");

    const backup = await writeOldServerDaemonConfig({
      dataDir,
      headers: {},
      serverUrl: "https://desktop.example.test",
    });

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      serverUrl: "https://desktop.example.test",
    });
    await restoreOldServerDaemonConfig(backup);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a config.json the managed config schema rejects and leaves it untouched", async () => {
    const dataDir = await makeDataDir();
    const path = join(dataDir, "config.json");
    await writeFile(path, '{"notAManagedKey":true}\n');

    await expect(
      writeOldServerDaemonConfig({
        dataDir,
        headers: {},
        serverUrl: "https://desktop.example.test",
      }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe('{"notAManagedKey":true}\n');
  });
});

describe("server moved targets", () => {
  const connectedHosts = [
    { id: "host-old", type: "persistent" as const },
    { id: "host-new", type: "persistent" as const },
    { id: "host-worker", type: "persistent" as const },
    { id: "host-sandbox", type: "ephemeral" as const },
  ];

  it("tells every connected persistent machine except the target in direct mode", () => {
    expect(
      listServerMovedTargets({
        connectedHosts,
        mode: "direct",
        sourceServerHostId: "host-old",
        targetHostId: "host-new",
      }),
    ).toEqual(["host-old", "host-worker"]);
  });

  it("tells only the old server's own machine in connect mode", () => {
    expect(
      listServerMovedTargets({
        connectedHosts,
        mode: "connect",
        sourceServerHostId: "host-old",
        targetHostId: "host-new",
      }),
    ).toEqual(["host-old"]);
    expect(
      listServerMovedTargets({
        connectedHosts: connectedHosts.slice(1),
        mode: "connect",
        sourceServerHostId: "host-old",
        targetHostId: "host-new",
      }),
    ).toEqual([]);
  });
});

describe("old copy entries", () => {
  it("keeps the daemon's config and env and passes the lock file schema", () => {
    const entries = listOldCopyEntries([
      { path: "bb.db" },
      { path: "config.json" },
      { path: "env.json" },
      { path: "attachments" },
      { path: "plugins/tasks/data.db" },
      { path: "plugins/tasks/secrets" },
    ]);

    expect(entries).toEqual([
      "attachments",
      "bb.db",
      "plugins/tasks/data.db",
      "plugins/tasks/secrets",
    ]);
    expect(
      serverMovedFileSchema.parse({
        version: 1,
        moveId: "move-1",
        movedAt: 1,
        fromHostId: "host-old",
        toHostId: "host-new",
        toHostName: "Desktop",
        serverUrl: "https://desktop.example.test",
        mode: "direct",
        connectHandle: null,
        oldCopyEntries: entries,
      }).oldCopyEntries,
    ).toEqual(entries);
  });
});
