import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureHomeEnvironment } from "./home-environment.js";

function childConfigPath(): string {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      'process.stdout.write(require("node:path").join(process.env.HOME, ".config", "gh"))',
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.skipIf(process.platform === "win32")("daemon HOME environment", () => {
  it.each([undefined, ""])(
    "lets child CLIs resolve their user config when HOME is %j",
    (home) => {
      vi.stubEnv("HOME", home);

      ensureHomeEnvironment();

      expect(childConfigPath()).toBe(join(userInfo().homedir, ".config", "gh"));
    },
  );

  it("preserves an explicit HOME for child processes", () => {
    const home = join(userInfo().homedir, "custom home");
    vi.stubEnv("HOME", home);

    ensureHomeEnvironment();

    expect(childConfigPath()).toBe(join(home, ".config", "gh"));
  });
});
