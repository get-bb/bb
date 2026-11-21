import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import {
  ServerDataDirInUseError,
  lockServerDataDir,
} from "../../src/services/system/data-dir-lock.js";

it("refuses a second server on a data directory until the first releases it (#7360)", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-server-data-dir-lock-"));
  onTestFinished(() => rm(dataDir, { recursive: true, force: true }));

  const releaseFirst = await lockServerDataDir({ dataDir, timeoutMs: 100 });
  await expect(
    lockServerDataDir({ dataDir, timeoutMs: 100 }),
  ).rejects.toBeInstanceOf(ServerDataDirInUseError);

  await releaseFirst();
  const releaseSecond = await lockServerDataDir({ dataDir, timeoutMs: 100 });
  await releaseSecond();
});
