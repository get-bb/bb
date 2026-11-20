import { spawnHostProcess } from "@bb/process-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { waitForProcessExit } from "../src/child-process-exit.js";

it("rejects when a child process cannot start", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-process-start-failure-"));
  try {
    const command = join(directory, "missing-command");
    const childProcess = spawnHostProcess(command, [], { stdio: "ignore" });

    await expect(waitForProcessExit(childProcess)).rejects.toMatchObject({
      code: "ENOENT",
      path: command,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 2_000);
