import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureHomeEnvironment } from "./home-environment.js";

function childHome(): string {
  const result = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(String(process.env.HOME))"],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.skipIf(process.platform === "win32")("ensureHomeEnvironment", () => {
  it.each([undefined, ""])(
    "gives child processes the account's home when HOME is %j",
    (home) => {
      vi.stubEnv("HOME", home);
      ensureHomeEnvironment();
      expect(childHome()).toBe(userInfo().homedir);
    },
  );

  it("keeps an explicit HOME", () => {
    vi.stubEnv("HOME", "/srv/custom home");
    ensureHomeEnvironment();
    expect(childHome()).toBe("/srv/custom home");
  });
});
