import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveDevInstanceConfig,
  resolveInheritedDevSkillsRootPaths,
  toDevProcessEnv,
} from "@bb/config/runtime";
import { createDevTurboCommand } from "../src/commands/run-dev.js";
import { migrateLegacyDevData } from "../src/lib/legacy-dev-data-migration.js";
import {
  expectedDevDataDir,
  expectedDevInstanceId,
  expectedDevPorts,
  expectedDevServerUrl,
} from "./dev-instance-expectations.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await fs.access(pathToCheck);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("run-dev", () => {
  it("derives stable data and ports from a managed checkout", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/.bb-dev/projects/env_q7e5i54kxt/bb";
    const config = resolveDevInstanceConfig({ homeDir, repoRoot });

    expect(config.instanceId).toBe(
      expectedDevInstanceId({ homeDir, repoRoot }),
    );
    expect(config.dataDir).toBe(expectedDevDataDir({ homeDir, repoRoot }));
    expect(config.ports).toEqual(expectedDevPorts(repoRoot));
    expect(config.serverUrl).toBe(expectedDevServerUrl(repoRoot));
    expect(new Set(Object.values(config.ports))).toHaveLength(3);
    expect(Object.values(config.ports)).not.toContain(5173);
    expect(Object.values(config.ports)).not.toContain(3334);
    expect(Object.values(config.ports)).not.toContain(3002);
    expect(Object.values(config.ports)).not.toContain(38886);
    expect(Object.values(config.ports)).not.toContain(38887);
  });

  it("uses the home-relative checkout path for non-managed checkout paths", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/src/work/bb-feature-copy";

    const config = resolveDevInstanceConfig({ homeDir, repoRoot });

    expect(config.instanceId).toBe(
      expectedDevInstanceId({ homeDir, repoRoot }),
    );
  });

  it("overrides instance selectors while preserving unrelated environment", () => {
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot: "/Users/tester/.bb-dev/projects/env_q7e5i54kxt/bb",
    });
    const baseEnv: NodeJS.ProcessEnv = {
      BB_DATA_DIR: "/Users/tester/.bb-dev",
      BB_SERVER_PORT: "3334",
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key",
    };

    const env = toDevProcessEnv({ baseEnv, config });

    expect(env.OPENAI_API_KEY).toBe("test-key");
    expect(env.NODE_ENV).toBe("development");
    expect(env.BB_DATA_DIR).toBe(config.dataDir);
    expect(env.BB_SERVER_PORT).toBe(String(config.ports.serverPort));
    expect(env.BB_SERVER_URL).toBe(config.serverUrl);
    expect(env.BB_HOST_DAEMON_PORT).toBe(String(config.ports.hostDaemonPort));
    expect(env.BB_DEV_APP_PORT).toBe(String(config.ports.appPort));
  });

  it("inherits parent bb skills for managed worktree dev apps", () => {
    const repoRoot =
      "/Users/tester/.bb-dev/code-bb-abc123/worktrees/env_feature/bb";
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot,
    });

    expect(resolveInheritedDevSkillsRootPaths({ repoRoot })).toEqual([
      "/Users/tester/.bb-dev/code-bb-abc123/skills",
    ]);
    expect(toDevProcessEnv({ baseEnv: {}, config })).toMatchObject({
      BB_INHERITED_SKILLS_ROOTS:
        "/Users/tester/.bb-dev/code-bb-abc123/skills",
    });
  });

  it("does not inherit bb skills for ordinary checkout dev apps", () => {
    const repoRoot = "/Users/tester/src/bb";
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot,
    });

    expect(resolveInheritedDevSkillsRootPaths({ repoRoot })).toEqual([]);
    expect(
      toDevProcessEnv({ baseEnv: {}, config }).BB_INHERITED_SKILLS_ROOTS,
    ).toBeUndefined();
  });

  it("strips parent thread context from dev child processes", () => {
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot: "/Users/tester/src/bb",
    });
    const baseEnv: NodeJS.ProcessEnv = {
      BB_ENVIRONMENT_ID: "env_parent",
      BB_PROJECT_ID: "proj_parent",
      BB_THREAD_ID: "thr_parent",
      BB_THREAD_STORAGE: "/Users/tester/.bb/thread-storage/thr_parent",
    };

    const env = toDevProcessEnv({ baseEnv, config });

    expect(env.BB_ENVIRONMENT_ID).toBeUndefined();
    expect(env.BB_THREAD_ID).toBeUndefined();
    expect(env.BB_THREAD_STORAGE).toBeUndefined();
    expect(env.BB_PROJECT_ID).toBe("proj_parent");
  });

  it("runs the same persistent dev tasks as pnpm dev", () => {
    expect(createDevTurboCommand()).toEqual({
      args: [
        "exec",
        "turbo",
        "run",
        "dev",
        "--filter=@bb/app",
        "--filter=@bb/server",
        "--filter=@bb/host-daemon",
        "--ui",
        "tui",
        "--concurrency",
        "20",
        "--no-update-notifier",
      ],
      command: "pnpm",
    });
  });

  it("migrates legacy flat dev data into the checkout instance", async () => {
    const homeDir = await makeTempDir("bb-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(path.join(legacyDataDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(legacyDataDir, "attachments", "proj_test"), {
      recursive: true,
    });
    await fs.mkdir(path.join(legacyDataDir, "worktrees", "env_old", "bb"), {
      recursive: true,
    });
    await fs.mkdir(path.join(legacyDataDir, "dev-supervisors"), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyDataDir, "bb.db"), "db", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "bb.db.backup-20260515-160305"),
      "backup",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "auth-secret"),
      "secret",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "attachments", "proj_test", "screenshot.png"),
      "image",
      "utf8",
    );
    await fs.writeFile(path.join(legacyDataDir, "daemon.lock"), "lock", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "dev-supervisors", "server.pid"),
      "not-a-pid",
      "utf8",
    );
    const output = { write: vi.fn() };

    const result = await migrateLegacyDevData({ config, output });

    expect(result).toEqual({
      migratedEntries: [
        "attachments",
        "auth-secret",
        "bb.db",
        "bb.db.backup-20260515-160305",
        "logs",
      ],
    });
    await expect(
      fs.readFile(path.join(config.dataDir, "bb.db"), "utf8"),
    ).resolves.toBe("db");
    await expect(
      fs.readFile(path.join(config.dataDir, "auth-secret"), "utf8"),
    ).resolves.toBe("secret");
    await expect(
      fs.readFile(
        path.join(config.dataDir, "attachments", "proj_test", "screenshot.png"),
        "utf8",
      ),
    ).resolves.toBe("image");
    await expect(
      fs.access(path.join(legacyDataDir, "worktrees", "env_old", "bb")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacyDataDir, "dev-supervisors", "server.pid")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacyDataDir, "daemon.lock")),
    ).resolves.toBeUndefined();
    expect(output.write).toHaveBeenCalledWith(
      expect.stringContaining(
        `Migrated legacy dev data into ${config.dataDir}`,
      ),
    );
  });

  it("skips migration when the target instance already has data", async () => {
    const homeDir = await makeTempDir("bb-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(path.join(legacyDataDir, "bb.db"), "legacy", "utf8");
    await fs.writeFile(path.join(config.dataDir, "bb.db"), "target", "utf8");

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "target-exists",
    });
    await expect(
      fs.readFile(path.join(legacyDataDir, "bb.db"), "utf8"),
    ).resolves.toBe("legacy");
    await expect(
      fs.readFile(path.join(config.dataDir, "bb.db"), "utf8"),
    ).resolves.toBe("target");
  });

  it("skips migration when legacy dev data is absent", async () => {
    const homeDir = await makeTempDir("bb-dev-home-");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-data-not-found",
    });
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("skips migration when legacy dev data has no migratable entries", async () => {
    const homeDir = await makeTempDir("bb-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(path.join(legacyDataDir, "daemon.lock"), "lock", "utf8");

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-data-empty",
    });
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("rolls back already moved entries when migration rename fails", async () => {
    const homeDir = await makeTempDir("bb-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDataDir, "auth-secret"),
      "secret",
      "utf8",
    );
    await fs.writeFile(path.join(legacyDataDir, "bb.db"), "db", "utf8");
    const renameCalls: string[] = [];
    const renameWithInjectedFailure = vi.fn(
      async (sourcePath: string, targetPath: string): Promise<void> => {
        renameCalls.push(path.basename(sourcePath));
        if (renameCalls.length === 1) {
          await fs.rename(sourcePath, targetPath);
          return;
        }

        throw new Error("injected rename failure");
      },
    );

    await expect(
      migrateLegacyDevData({
        config,
        dependencies: {
          rename: renameWithInjectedFailure,
        },
      }),
    ).rejects.toThrow("injected rename failure");

    expect(renameCalls).toEqual(["auth-secret", "bb.db"]);
    await expect(
      fs.readFile(path.join(legacyDataDir, "auth-secret"), "utf8"),
    ).resolves.toBe("secret");
    await expect(
      fs.readFile(path.join(legacyDataDir, "bb.db"), "utf8"),
    ).resolves.toBe("db");
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("does not migrate legacy data while a legacy dev supervisor is running", async () => {
    const homeDir = await makeTempDir("bb-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(path.join(legacyDataDir, "dev-supervisors"), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyDataDir, "bb.db"), "db", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "dev-supervisors", "server.pid"),
      `${process.pid}\n`,
      "utf8",
    );

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-dev-process-running",
    });
    await expect(
      fs.readFile(path.join(legacyDataDir, "bb.db"), "utf8"),
    ).resolves.toBe("db");
    expect(await pathExists(config.dataDir)).toBe(false);
  });
});
