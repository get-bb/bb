import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { experimental_killProcessesWithCwdUnder } from "../host.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;
const cleanupDirs: string[] = [];
const cleanupChildren: ChildProcess[] = [];

afterEach(() => {
  for (const child of cleanupChildren.splice(0)) child.kill("SIGKILL");
  for (const dir of cleanupDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

posixOnly("experimental_killProcessesWithCwdUnder", () => {
  it("still kills processes for plugins that pass the pre-0.6.27 { directory } input", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "bb-sdk-cwd-sweep-")));
    cleanupDirs.push(dir);
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        cwd: dir,
        stdio: "ignore",
      },
    );
    cleanupChildren.push(child);
    const exited = new Promise((resolve) => child.once("exit", resolve));

    const killed = await experimental_killProcessesWithCwdUnder(
      // @ts-expect-error the legacy input is accepted at runtime but not typed
      { directory: dir, graceMs: 200 },
    );

    expect(killed.map((entry) => entry.pid)).toContain(child.pid);
    await exited;
  });
});
