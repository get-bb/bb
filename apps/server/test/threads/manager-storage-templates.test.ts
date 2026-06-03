import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSession } from "@bb/db";
import type { ManagerTemplateName } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_MANAGER_TEMPLATE_FILE_NAME,
  DEFAULT_MANAGER_TEMPLATE_NAME,
  managerTemplateRootPath,
  seedManagerThreadStorage,
} from "../../src/services/threads/manager-storage-templates.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import { seedHost } from "../helpers/seed.js";
import { createTestAppHarness, testLogger, withTestHarness } from "../helpers/test-app.js";

const MINE_MANAGER_TEMPLATE_NAME: ManagerTemplateName = "mine";

interface SeedHarness {
  dataDir: string;
  harness: TestAppHarness;
  hostId: string;
}

interface WriteManagerTemplateSetArgs {
  dataDir: string;
  files: Record<string, string>;
  name: ManagerTemplateName;
}

interface WriteActiveManagerTemplateArgs {
  dataDir: string;
  name: ManagerTemplateName;
}

interface SeedStorageArgs {
  dataDir: string;
  explicitTemplateName: ManagerTemplateName | null;
  harness: TestAppHarness;
  hostId: string;
  logger?: typeof testLogger;
  threadId: string;
}

async function makeDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "bb-manager-templates-"));
}

async function createSeedHarness(): Promise<SeedHarness> {
  const harness = await createTestAppHarness();
  const dataDir = await makeDataDir();
  const host = seedHost(harness.deps, { id: "host-manager-template" });
  openSession(harness.db, harness.hub, {
    hostId: host.id,
    instanceId: "manager-template-test",
    hostName: "Manager Template Test Host",
    hostType: "persistent",
    dataDir,
    protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
    heartbeatIntervalMs: 5_000,
    leaseTimeoutMs: 30_000,
  });
  return {
    dataDir,
    harness,
    hostId: host.id,
  };
}

async function writeManagerTemplateSet(
  args: WriteManagerTemplateSetArgs,
): Promise<void> {
  const templateDir = path.join(
    managerTemplateRootPath({ dataDir: args.dataDir }),
    args.name,
  );
  await mkdir(templateDir, { recursive: true });
  for (const [fileName, content] of Object.entries(args.files)) {
    const filePath = path.join(templateDir, fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

async function writeActiveManagerTemplate(
  args: WriteActiveManagerTemplateArgs,
): Promise<void> {
  const templateRootPath = managerTemplateRootPath({ dataDir: args.dataDir });
  await mkdir(templateRootPath, { recursive: true });
  await writeFile(
    path.join(templateRootPath, ACTIVE_MANAGER_TEMPLATE_FILE_NAME),
    `${args.name}\n`,
    "utf8",
  );
}

async function seedStorage(args: SeedStorageArgs): Promise<string> {
  const threadStoragePath = path.join(
    args.dataDir,
    "thread-storage",
    args.threadId,
  );
  await seedManagerThreadStorage(
    {
      ...args.harness.deps,
      logger: args.logger ?? args.harness.deps.logger,
    },
    {
      explicitTemplateName: args.explicitTemplateName,
      hostId: args.hostId,
      threadId: args.threadId,
      threadStoragePath,
    },
  );
  return threadStoragePath;
}

describe("manager storage templates", () => {
  it("does not create manager templates during server bootstrap", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        stat(managerTemplateRootPath({ dataDir: harness.config.dataDir })),
      ).rejects.toThrow();
    });
  });

  it("does not seed hidden default files when no user template directory exists", async () => {
    const { dataDir, harness, hostId } = await createSeedHarness();
    try {
      const threadStoragePath = await seedStorage({
        dataDir,
        explicitTemplateName: null,
        harness,
        hostId,
        threadId: "thr-default-fallback",
      });

      await expect(stat(threadStoragePath)).rejects.toThrow();
      await expect(
        stat(managerTemplateRootPath({ dataDir })),
      ).rejects.toThrow();
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("copies user-authored default template files", async () => {
    const { dataDir, harness, hostId } = await createSeedHarness();
    try {
      await writeManagerTemplateSet({
        dataDir,
        name: DEFAULT_MANAGER_TEMPLATE_NAME,
        files: {
          "USER.md": "user notes\n",
          "notes/state.json": '{"prs":[]}\n',
        },
      });

      const threadStoragePath = await seedStorage({
        dataDir,
        explicitTemplateName: null,
        harness,
        hostId,
        threadId: "thr-user-default",
      });

      await expect(
        readFile(path.join(threadStoragePath, "USER.md"), "utf8"),
      ).resolves.toBe("user notes\n");
      await expect(
        readFile(path.join(threadStoragePath, "notes/state.json"), "utf8"),
      ).resolves.toBe('{"prs":[]}\n');
      await expect(
        stat(path.join(threadStoragePath, "apps", "status", "manifest.json")),
      ).rejects.toThrow();
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite files that already exist in thread storage", async () => {
    const { dataDir, harness, hostId } = await createSeedHarness();
    try {
      await writeManagerTemplateSet({
        dataDir,
        name: DEFAULT_MANAGER_TEMPLATE_NAME,
        files: {
          "USER.md": "template notes\n",
        },
      });
      const threadStoragePath = path.join(
        dataDir,
        "thread-storage",
        "thr-user-overrides",
      );
      await mkdir(threadStoragePath, { recursive: true });
      await writeFile(
        path.join(threadStoragePath, "USER.md"),
        "existing notes\n",
        "utf8",
      );

      await seedStorage({
        dataDir,
        explicitTemplateName: null,
        harness,
        hostId,
        threadId: "thr-user-overrides",
      });

      await expect(
        readFile(path.join(threadStoragePath, "USER.md"), "utf8"),
      ).resolves.toBe("existing notes\n");
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates an empty storage directory when the default template directory is empty", async () => {
    const { dataDir, harness, hostId } = await createSeedHarness();
    try {
      await writeManagerTemplateSet({
        dataDir,
        name: DEFAULT_MANAGER_TEMPLATE_NAME,
        files: {},
      });

      const threadStoragePath = await seedStorage({
        dataDir,
        explicitTemplateName: null,
        harness,
        hostId,
        threadId: "thr-empty-default",
      });

      const storageStat = await stat(threadStoragePath);
      expect(storageStat.isDirectory()).toBe(true);
      await expect(
        stat(path.join(threadStoragePath, "apps", "status", "manifest.json")),
      ).rejects.toThrow();
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("warns and seeds nothing when active points to a missing non-default template", async () => {
    const { dataDir, harness, hostId } = await createSeedHarness();
    const logger = {
      ...testLogger,
      debug: vi.fn(),
      warn: vi.fn(),
    };
    try {
      await writeActiveManagerTemplate({
        dataDir,
        name: MINE_MANAGER_TEMPLATE_NAME,
      });

      const threadStoragePath = await seedStorage({
        dataDir,
        explicitTemplateName: null,
        harness,
        hostId,
        logger,
        threadId: "thr-missing-active",
      });

      await expect(stat(threadStoragePath)).rejects.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: MINE_MANAGER_TEMPLATE_NAME,
          threadId: "thr-missing-active",
        }),
        "Manager template directory is missing; no template files were seeded",
      );
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("warns and seeds nothing when an explicit non-default template is missing", async () => {
    const { dataDir, harness, hostId } = await createSeedHarness();
    const logger = {
      ...testLogger,
      debug: vi.fn(),
      warn: vi.fn(),
    };
    try {
      const threadStoragePath = await seedStorage({
        dataDir,
        explicitTemplateName: MINE_MANAGER_TEMPLATE_NAME,
        harness,
        hostId,
        logger,
        threadId: "thr-missing-explicit",
      });

      await expect(stat(threadStoragePath)).rejects.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: MINE_MANAGER_TEMPLATE_NAME,
          threadId: "thr-missing-explicit",
        }),
        "Manager template directory is missing; no template files were seeded",
      );
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("seeds from the active non-default template when that directory exists", async () => {
    const { dataDir, harness, hostId } = await createSeedHarness();
    try {
      await writeActiveManagerTemplate({
        dataDir,
        name: MINE_MANAGER_TEMPLATE_NAME,
      });
      await writeManagerTemplateSet({
        dataDir,
        name: MINE_MANAGER_TEMPLATE_NAME,
        files: {
          "apps/mine/manifest.json": "{}\n",
          "apps/mine/data/state.json": "{}\n",
        },
      });

      const threadStoragePath = await seedStorage({
        dataDir,
        explicitTemplateName: null,
        harness,
        hostId,
        threadId: "thr-active-mine",
      });

      await expect(
        readFile(
          path.join(threadStoragePath, "apps/mine/manifest.json"),
          "utf8",
        ),
      ).resolves.toBe("{}\n");
      await expect(
        readFile(
          path.join(threadStoragePath, "apps/mine/data/state.json"),
          "utf8",
        ),
      ).resolves.toBe("{}\n");
      await expect(
        stat(path.join(threadStoragePath, "apps", "status", "manifest.json")),
      ).rejects.toThrow();
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
