import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { listProcessesWithCwdUnder } from "../src/cwd-processes.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it.skipIf(process.platform === "win32")(
  "finds processes in a deleted directory addressed through a symlinked ancestor",
  async () => {
    const base = await realpath(
      await mkdtemp(join(tmpdir(), "bb-cwd-processes-")),
    );
    cleanups.push(() => rm(base, { recursive: true, force: true }));
    const real = join(base, "real");
    const working = join(real, "checkout", "bb");
    await mkdir(working, { recursive: true });
    await symlink(real, join(base, "link"));
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        cwd: working,
        stdio: "ignore",
      },
    );
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    cleanups.push(async () => {
      child.kill("SIGKILL");
      await exited;
    });
    await rm(join(real, "checkout"), { recursive: true });

    await expect
      .poll(async () =>
        (
          await listProcessesWithCwdUnder({
            directory: join(base, "link", "checkout", "bb"),
          })
        ).map((entry) => entry.pid),
      )
      .toEqual([child.pid]);
  },
);
