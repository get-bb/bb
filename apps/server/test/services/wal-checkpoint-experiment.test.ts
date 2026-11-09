import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConnection, migrate, setExperiments } from "@bb/db";
import { startGatedWalCheckpointer } from "../../src/services/system/wal-checkpoint-experiment.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { testLogger } from "../helpers/test-app.js";

async function waitForAutocheckpoint(
  read: () => unknown,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (read() !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(read()).toBe(expected);
}

describe("startGatedWalCheckpointer", () => {
  it("hands bb.db to the checkpoint worker only while walCheckpointWorker is on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-wal-checkpoint-experiment-"));
    const db = createConnection(join(dir, "bb.db"));
    migrate(db);
    const hub = new NotificationHub();
    const checkpointer = startGatedWalCheckpointer({
      db,
      hub,
      logger: testLogger,
    });
    const autocheckpoint = () =>
      db.$client.pragma("wal_autocheckpoint", { simple: true });
    try {
      checkpointer.attach(db.$client);
      await checkpointer.checkpoint(db.$client);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(autocheckpoint()).toBe(1_000);

      setExperiments(db, { walCheckpointWorker: true });
      hub.notifySystem(["config-changed"]);
      await waitForAutocheckpoint(autocheckpoint, 0);

      setExperiments(db, { walCheckpointWorker: false });
      hub.notifySystem(["config-changed"]);
      await checkpointer.checkpoint(db.$client);
      expect(autocheckpoint()).toBe(1_000);
    } finally {
      await checkpointer.stop();
      db.$client.close();
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
