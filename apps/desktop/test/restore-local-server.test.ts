import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type MovedServerProbeResult,
  readServerMovedFile,
  writeServerMovedFile,
  type ServerMovedFile,
} from "@bb/server-archive";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  removeMachineService,
  restoreLocalServer,
  type RestoreLocalServerConfirmation,
} from "../src/restore-local-server.js";

const SERVICE_FILE =
  "/Users/me/Library/LaunchAgents/app.getbb.host-daemon.abc.plist";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function createLockedDataDir(
  overrides: Partial<ServerMovedFile> = {},
): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-desktop-restore-"));
  tempDirs.push(dataDir);
  await writeServerMovedFile(dataDir, {
    connectHandle: "desk",
    fromHostId: "host-laptop",
    mode: "connect",
    moveId: "move-1",
    movedAt: 1_750_000_000_000,
    oldCopyEntries: ["bb.db"],
    serverUrl: "https://desk.getbb.app/",
    toHostId: "host-desktop",
    toHostName: "Studio desktop",
    version: 1,
    ...overrides,
  });
  await writeFile(
    join(dataDir, "config.json"),
    `${JSON.stringify({
      connectMachineId: "machine-1",
      machineCredential: "secret",
      serverUrl: "https://desk.getbb.app",
    })}\n`,
  );
  return dataDir;
}

function createHarness(args: {
  confirmed?: boolean;
  dataDir: string;
  probe?: MovedServerProbeResult;
  serviceFile?: string | null;
}) {
  const confirmations: RestoreLocalServerConfirmation[] = [];
  const removeService = vi.fn(async () => undefined);
  return {
    confirmations,
    removeService,
    run: () =>
      restoreLocalServer({
        async confirm(confirmation) {
          confirmations.push(confirmation);
          return args.confirmed ?? true;
        },
        dataDir: args.dataDir,
        findService: async () => args.serviceFile ?? null,
        probeMovedServer: async () => args.probe ?? { kind: "not-running" },
        removeService,
      }),
  };
}

describe("restoreLocalServer", () => {
  it("removes the lock and the moved server address once confirmed", async () => {
    const dataDir = await createLockedDataDir();
    const harness = createHarness({ dataDir });

    await expect(harness.run()).resolves.toEqual({ kind: "restored" });

    await expect(readServerMovedFile(dataDir)).resolves.toBeNull();
    expect(
      JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
    ).toEqual({});
    expect(harness.confirmations[0]?.detail).toContain("Studio desktop");
    expect(harness.confirmations[0]?.detail).toContain(
      "If both copies run, they can conflict",
    );
    expect(harness.confirmations[0]?.confirmLabel).toBe("Confirm");
  });

  it("keeps everything when the user cancels", async () => {
    const dataDir = await createLockedDataDir();
    const harness = createHarness({
      confirmed: false,
      dataDir,
      serviceFile: SERVICE_FILE,
    });

    await expect(harness.run()).resolves.toEqual({ kind: "cancelled" });

    await expect(readServerMovedFile(dataDir)).resolves.not.toBeNull();
    expect(harness.removeService).not.toHaveBeenCalled();
  });

  it("refuses without asking while the new server still runs", async () => {
    const dataDir = await createLockedDataDir();
    const harness = createHarness({ dataDir, probe: { kind: "running" } });

    await expect(harness.run()).resolves.toMatchObject({ kind: "refused" });

    expect(harness.confirmations).toEqual([]);
    await expect(readServerMovedFile(dataDir)).resolves.not.toBeNull();
  });

  it("refuses when the old copy was deleted after the move", async () => {
    const dataDir = await createLockedDataDir({ oldCopyEntries: [] });
    const harness = createHarness({ dataDir });

    await expect(harness.run()).resolves.toMatchObject({ kind: "refused" });

    expect(harness.confirmations).toEqual([]);
  });

  it("warns when the new server's state is unconfirmed", async () => {
    const dataDir = await createLockedDataDir();
    const harness = createHarness({
      dataDir,
      probe: { kind: "unconfirmed", status: 401 },
    });

    await harness.run();

    expect(harness.confirmations[0]?.detail).toContain("HTTP 401");
  });

  it("removes the machine service before it unlocks", async () => {
    const dataDir = await createLockedDataDir();
    const harness = createHarness({ dataDir, serviceFile: SERVICE_FILE });
    harness.removeService.mockImplementation(async () => {
      await expect(readServerMovedFile(dataDir)).resolves.not.toBeNull();
    });

    await expect(harness.run()).resolves.toEqual({ kind: "restored" });

    expect(harness.removeService).toHaveBeenCalledWith(SERVICE_FILE);
    expect(harness.confirmations[0]?.detail).toContain("background connection");
  });

  it("stays locked when the service cannot be removed", async () => {
    const dataDir = await createLockedDataDir();
    const harness = createHarness({ dataDir, serviceFile: SERVICE_FILE });
    harness.removeService.mockRejectedValue(new Error("launchctl failed"));

    await expect(harness.run()).rejects.toThrow("launchctl failed");

    await expect(readServerMovedFile(dataDir)).resolves.not.toBeNull();
  });
});

describe("removeMachineService", () => {
  it("keeps a launchd service file when bootout fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-desktop-service-"));
    tempDirs.push(dataDir);
    const serviceFile = join(dataDir, "bb-machine.plist");
    await writeFile(serviceFile, "service");
    const runCommand = vi.fn(async () => {
      throw new Error("bootout failed");
    });

    await expect(removeMachineService(serviceFile, runCommand)).rejects.toThrow(
      "bootout failed",
    );

    expect(runCommand).toHaveBeenCalledWith("launchctl", [
      "bootout",
      `gui/${String(process.getuid?.() ?? 0)}`,
      serviceFile,
    ]);
    await expect(readFile(serviceFile, "utf8")).resolves.toBe("service");
  });
});
