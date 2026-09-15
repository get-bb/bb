import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SERVER_CONNECT_HOLD_FILE_NAME,
  writeServerConnectHoldFile,
} from "@bb/server-archive";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_HOLD_DETAIL,
  readConnectHold,
} from "../../src/services/server-move/connect-hold.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function makeDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-connect-hold-"));
  tempDirs.push(dataDir);
  return dataDir;
}

describe("bb connect hold at boot", () => {
  it("holds the builtin connect plugin while server-connect-hold.json exists, even when it can't be read", async () => {
    const dataDir = await makeDataDir();
    const logger = { warn: vi.fn() };
    const held = { source: "builtin:connect", detail: CONNECT_HOLD_DETAIL };

    expect(await readConnectHold({ dataDir, logger })).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();

    await writeServerConnectHoldFile(dataDir, {
      version: 1,
      reason: "manual-import",
      createdAt: 1,
    });
    expect(await readConnectHold({ dataDir, logger })).toEqual(held);

    await writeFile(join(dataDir, SERVER_CONNECT_HOLD_FILE_NAME), "not json");
    expect(await readConnectHold({ dataDir, logger })).toEqual(held);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
