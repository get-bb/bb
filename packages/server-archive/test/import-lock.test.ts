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
import { withFileLock } from "@bb/config/file-lock";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractServerArchive,
  installImportedServerFiles,
  listServerOwnedEntries,
  type ServerArchiveManifest,
  writeServerArchive,
} from "../src/index.js";

const lockAttempts = vi.hoisted(() => {
  const waiters = new Map<string, () => void>();
  return {
    notify(lockPath: string): void {
      waiters.get(lockPath)?.();
    },
    next(lockPath: string): Promise<void> {
      return new Promise<void>((resolve) => {
        waiters.set(lockPath, resolve);
      });
    },
  };
});

vi.mock("@bb/config/file-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/config/file-lock")>();
  return {
    ...actual,
    withFileLock<T>(args: {
      path: string;
      timeoutMs: number;
      work: () => Promise<T>;
    }): Promise<T> {
      lockAttempts.notify(args.path);
      return actual.withFileLock(args);
    },
  };
});

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

async function readDataJson(
  dataDir: string,
  relativePath: string,
): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dataDir, relativePath), "utf8"));
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
  await writeDataFile(
    sourceDataDir,
    "env.json",
    JSON.stringify({ env: { SOURCE_ONLY: "1" } }),
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

async function holdLock(
  lockPath: string,
): Promise<{ release: () => void; released: Promise<void> }> {
  let release: () => void = () => undefined;
  const releaseRequested = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired: () => void = () => undefined;
  const lockAcquired = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const released = withFileLock({
    path: lockPath,
    timeoutMs: 1_000,
    work: async () => {
      acquired();
      await releaseRequested;
    },
  });
  await lockAcquired;
  return { release, released };
}

describe("installImportedServerFiles managed file locks", () => {
  it("waits for another bb command's config.json lock and merges what that command wrote", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await makeTempDir();
    await writeDataFile(
      dataDir,
      "config.json",
      JSON.stringify({ config: { BB_APP_URL: "https://target.example" } }),
    );
    const lockPath = path.join(dataDir, ".config.json.lock");
    const lock = await holdLock(lockPath);
    const attempted = lockAttempts.next(lockPath);

    const install = installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });
    const firstOutcome = await Promise.race([
      attempted.then(() => "waiting on the lock" as const),
      install.then(() => "finished" as const),
    ]);
    const configWhileLocked = await readDataJson(dataDir, "config.json");
    const entriesWhileLocked = await readdir(dataDir);
    await writeDataFile(
      dataDir,
      "config.json",
      JSON.stringify({ config: { BB_APP_URL: "https://changed.example" } }),
    );
    lock.release();
    await lock.released;
    await install;

    expect(firstOutcome).toBe("waiting on the lock");
    expect(configWhileLocked).toEqual({
      config: { BB_APP_URL: "https://target.example" },
    });
    expect(entriesWhileLocked).not.toContain("bb.db");
    expect(await readDataJson(dataDir, "config.json")).toEqual({
      config: { BB_APP_URL: "https://changed.example", BB_LOG_LEVEL: "info" },
    });
    expect(await readdir(dataDir)).toContain("bb.db");
  });

  it("waits for another bb command's env.json lock and merges what that command wrote", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await makeTempDir();
    await writeDataFile(
      dataDir,
      "env.json",
      JSON.stringify({ env: { TARGET_ONLY: "1" } }),
    );
    const lockPath = path.join(dataDir, ".env.json.lock");
    const lock = await holdLock(lockPath);
    const attempted = lockAttempts.next(lockPath);

    const install = installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });
    const firstOutcome = await Promise.race([
      attempted.then(() => "waiting on the lock" as const),
      install.then(() => "finished" as const),
    ]);
    const envWhileLocked = await readDataJson(dataDir, "env.json");
    const configWhileLocked = await readDataJson(dataDir, "config.json");
    const entriesWhileLocked = await readdir(dataDir);
    await writeDataFile(
      dataDir,
      "env.json",
      JSON.stringify({ env: { TARGET_ONLY: "2" } }),
    );
    lock.release();
    await lock.released;
    await install;

    expect(firstOutcome).toBe("waiting on the lock");
    expect(envWhileLocked).toEqual({ env: { TARGET_ONLY: "1" } });
    expect(configWhileLocked).toEqual({ config: { BB_LOG_LEVEL: "info" } });
    expect(entriesWhileLocked).not.toContain("bb.db");
    expect(await readDataJson(dataDir, "env.json")).toEqual({
      env: { SOURCE_ONLY: "1", TARGET_ONLY: "2" },
    });
    expect(await readdir(dataDir)).toContain("bb.db");
  });
});
