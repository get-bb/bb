import { expect, it } from "vitest";
import {
  finishEnvironmentHookOperation,
  forgetFinishedEnvironmentHookOperations,
  getEnvironmentHookOperation,
  insertEnvironmentHookOperation,
} from "../../src/data/environment-hook-operations.js";
import { upsertHost } from "../../src/data/hosts.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";

it("forgets only the named hook operations that finished, so they run again, and keeps one still running", () => {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const insert = (id: string) =>
    insertEnvironmentHookOperation(db, {
      id,
      hostId: host.id,
      path: `/work/${id}`,
      kind: "setup",
      startedAt: 1,
    });
  for (const id of ["finished", "running", "untouched"]) insert(id);
  finishEnvironmentHookOperation(db, "finished", {
    finishedAt: 2,
    error: null,
  });
  finishEnvironmentHookOperation(db, "untouched", {
    finishedAt: 2,
    error: null,
  });

  forgetFinishedEnvironmentHookOperations(db, ["finished", "running"]);

  expect(getEnvironmentHookOperation(db, "finished")).toBeNull();
  expect(getEnvironmentHookOperation(db, "running")).toMatchObject({
    finishedAt: null,
  });
  expect(getEnvironmentHookOperation(db, "untouched")).toMatchObject({
    finishedAt: 2,
  });
});
