import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { withFileLock } from "@bb/config/file-lock";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractServerArchive,
  installImportedServerFiles,
  listServerOwnedEntries,
  type ServerArchiveManifest,
  writeServerArchive,
} from "../src/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-server-lock-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

async function writeDataFile(
  dataDir: string,
  relativePath: string,
  body: string,
): Promise<void> {
  const filePath = path.join(dataDir, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
}

async function stageImport(): Promise<{
  stagingDir: string;
  manifest: ServerArchiveManifest;
}> {
  const sourceDataDir = await makeTempDir();
  await writeDataFile(sourceDataDir, "bb.db", "server database");
  await writeDataFile(
    sourceDataDir,
    "config.json",
    JSON.stringify({ config: { BB_LOG_LEVEL: "info" } }),
  );
  await writeDataFile(sourceDataDir, "attachments/thr_1/image.png", "png");
  const inventory = await listServerOwnedEntries(sourceDataDir);
  const workDir = await makeTempDir();
  const archivePath = path.join(workDir, "server.tar.gz");
  await writeServerArchive({
    outPath: archivePath,
    files: inventory.entries
      .flatMap((entry) => entry.files)
      .map((file) => ({
        sourcePath: file.absolutePath,
        archivePath: file.path,
      })),
    manifest: {
      createdAt: 1,
      bbVersion: "0.43.1",
      protocolVersion: 209,
      migrationCount: 142,
      sourceDataDir,
      sourceServerHostId: "host-old",
      serverMoveExperiment: true,
    },
  });
  const stagingDir = path.join(workDir, "staging");
  const manifest = await extractServerArchive({
    archivePath,
    destinationDir: stagingDir,
  });
  return { stagingDir, manifest };
}

describe("installImportedServerFiles managed config lock", () => {
  it("waits for another bb command's config.json lock before writing the merged config", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await makeTempDir();
    const originalConfig = JSON.stringify({
      config: { BB_APP_URL: "https://target.example" },
    });
    await writeDataFile(dataDir, "config.json", originalConfig);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired: () => void = () => undefined;
    const lockAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = withFileLock({
      path: path.join(dataDir, ".config.json.lock"),
      timeoutMs: 1_000,
      work: async () => {
        acquired();
        await released;
      },
    });
    await lockAcquired;

    const install = installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });
    const whileLocked = await Promise.race([
      install.then(() => "finished" as const),
      sleep(500).then(() => "waiting" as const),
    ]);
    const configWhileLocked = await readFile(
      path.join(dataDir, "config.json"),
      "utf8",
    );
    const entriesWhileLocked = await readdir(dataDir);
    release();
    await holder;
    await install;

    expect(whileLocked).toBe("waiting");
    expect(configWhileLocked).toBe(originalConfig);
    expect(entriesWhileLocked).not.toContain("bb.db");
    expect(
      JSON.parse(await readFile(path.join(dataDir, "config.json"), "utf8")),
    ).toEqual({
      config: { BB_APP_URL: "https://target.example", BB_LOG_LEVEL: "info" },
    });
    expect(await readdir(dataDir)).toContain("bb.db");
  });
});
