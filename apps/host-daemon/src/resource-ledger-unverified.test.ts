import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { afterEach, expect, it, vi } from "vitest";
import { createTestResourceLedger } from "../test/resource-ledger-fixture.js";

vi.mock("@bb/process-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bb/process-utils")>()),
  stopRecordedProcesses: vi.fn(async () => "unverified"),
}));

const spawned: number[] = [];

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
});

it("keeps the record of processes whose termination could not be confirmed", async () => {
  const directory = await makeTempDir("bb-resource-ledger-");
  const ledger = createTestResourceLedger(directory);
  const resource = ledger.open({
    owner: { kind: "provider-runtime", environmentId: "env-1" },
    deadline: { kind: "owner" },
  });
  const child = spawn("sleep", ["60"], { stdio: "ignore" });
  spawned.push(child.pid!);
  resource.trackProcess({
    pid: child.pid!,
    processGroup: false,
    label: "sleep",
    startId: async () => null,
    exited: new Promise((resolve) => child.once("exit", () => resolve())),
  });

  await expect(resource.close()).resolves.toMatchObject({
    terminationUnverified: true,
  });

  const records = readdirSync(directory).filter((name) =>
    name.endsWith(".json"),
  );
  expect(records).toHaveLength(1);
  expect(
    JSON.parse(readFileSync(path.join(directory, records[0]!), "utf8")),
  ).toMatchObject({ processes: [expect.objectContaining({ pid: child.pid })] });
});
