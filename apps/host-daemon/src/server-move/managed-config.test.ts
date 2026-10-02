import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  restoreMachineConnectionConfig,
  rewriteManagedConfigServer,
  switchConfigToLocalServer,
} from "./managed-config.js";

const roots: string[] = [];

async function createDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bb-managed-config-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("rewriteManagedConfigServer", () => {
  it("points config.json at the new server and drops machine credentials", async () => {
    const dataDir = await createDataDir();
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({
        config: { BB_LOG_LEVEL: "debug" },
        customModels: [{ providerId: "codex", model: "gpt-custom" }],
        serverUrl: "https://old.example.test",
        serverHeaders: { "x-bb-connect-machine": "bbcm_old" },
        machineCredential: "bbcm_old",
        connectMachineId: "machine-1",
      }),
      { mode: 0o644 },
    );

    await rewriteManagedConfigServer({
      dataDir,
      serverUrl: "https://new.example.test",
      headers: { "x-bb-connect-machine": "bbcm_new" },
    });

    expect(
      JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
    ).toEqual({
      config: { BB_LOG_LEVEL: "debug" },
      customModels: [{ providerId: "codex", model: "gpt-custom" }],
      serverUrl: "https://new.example.test",
      serverHeaders: { "x-bb-connect-machine": "bbcm_new" },
    });
    expect((await stat(join(dataDir, "config.json"))).mode & 0o777).toBe(0o600);
  });

  it("refuses to rewrite an invalid config.json", async () => {
    const dataDir = await createDataDir();
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({ unknown: 1 }),
    );

    await expect(
      rewriteManagedConfigServer({
        dataDir,
        serverUrl: "https://new.example.test",
        headers: {},
      }),
    ).rejects.toThrow();
    expect(
      JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
    ).toEqual({
      unknown: 1,
    });
  });
});

describe("move import config handling", () => {
  it("restores this machine's connection keys from the pre-import backup", async () => {
    const dataDir = await createDataDir();
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({
        config: { BB_LOG_LEVEL: "info" },
        serverUrl: "http://127.0.0.1:38886",
        connectMachineId: "imported-server-machine",
      }),
    );
    const backupPath = join(dataDir, "backup-config.json");
    await writeFile(
      backupPath,
      JSON.stringify({
        config: { BB_LOG_LEVEL: "debug" },
        serverUrl: "https://old.example.test",
        serverHeaders: { "x-bb-connect-machine": "bbcm_target" },
        machineCredential: "bbcm_target",
      }),
    );

    await restoreMachineConnectionConfig({
      dataDir,
      backupConfigPath: backupPath,
    });

    expect(
      JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
    ).toEqual({
      config: { BB_LOG_LEVEL: "info" },
      serverUrl: "https://old.example.test",
      serverHeaders: { "x-bb-connect-machine": "bbcm_target" },
      machineCredential: "bbcm_target",
    });

    await switchConfigToLocalServer({
      dataDir,
      serverUrl: "http://127.0.0.1:38886",
    });

    expect(
      JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
    ).toEqual({
      config: { BB_LOG_LEVEL: "info" },
      serverUrl: "http://127.0.0.1:38886",
    });
  });

  it("removes connection keys the machine did not have before the import", async () => {
    const dataDir = await createDataDir();
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({ serverUrl: "http://127.0.0.1:38886" }),
    );

    await restoreMachineConnectionConfig({
      dataDir,
      backupConfigPath: join(dataDir, "missing-backup.json"),
    });

    expect(
      JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
    ).toEqual({});
  });
});
