import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { uninstallCommand } from "./uninstall.js";

const exec = promisify(execFile);
const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

async function fixture() {
  await mkdir("/tmp/pr2", { recursive: true });
  const home = await mkdtemp("/tmp/pr2/ssh-checkpoint-uninstall-");
  homes.push(home);
  await mkdir(join(home, ".bb"));
  await writeFile(join(home, ".bb", "unrelated"), "leave this instance alone");
  await mkdir(join(home, ".local", "bin"), { recursive: true });
  return {
    home,
    shim: join(home, ".local", "bin", "bb"),
    async run(hostId = "host_reserved") {
      const [command, ...args] = uninstallCommand(hostId);
      return exec(command, args, {
        env: { HOME: home, PATH: "/usr/bin:/bin" },
        timeout: 5_000,
      });
    },
  };
}

describe("SSH checkpoint removal", () => {
  it("succeeds without touching an unrelated instance when the early shim is absent", async () => {
    const f = await fixture();
    expect(await f.run()).toMatchObject({ stdout: "", stderr: "" });
    expect(await readFile(join(f.home, ".bb", "unrelated"), "utf8")).toBe(
      "leave this instance alone",
    );
  });
  it("delegates the reserved identity to core's ownership-checked lifecycle", async () => {
    const f = await fixture();
    await writeFile(
      f.shim,
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/arguments"\n',
      { mode: 0o755 },
    );
    await f.run();
    expect(await readFile(join(f.home, "arguments"), "utf8")).toBe(
      "machine\nuninstall\n--host-id\nhost_reserved\n",
    );
  });
  it("preserves an ownership refusal for cleanup retries", async () => {
    const f = await fixture();
    await writeFile(
      f.shim,
      '#!/bin/sh\nprintf "%s\\n" "ownership mismatch" >&2\nexit 2\n',
      { mode: 0o755 },
    );
    await expect(f.run()).rejects.toMatchObject({
      code: 2,
      stderr: "ownership mismatch\n",
    });
    expect(await readFile(join(f.home, ".bb", "unrelated"), "utf8")).toBe(
      "leave this instance alone",
    );
  });
  it("does not mistake a broken lifecycle shim for an installation that never began", async () => {
    const f = await fixture();
    await symlink(join(f.home, "missing-cli"), f.shim);
    await expect(f.run()).rejects.toMatchObject({ code: expect.any(Number) });
  });
});
