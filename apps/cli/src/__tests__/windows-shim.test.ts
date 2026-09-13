import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe.skipIf(process.platform !== "win32")("Windows CLI shim", () => {
  it("runs a prepared source CLI and reports a failed source build", () => {
    const root = mkdtempSync(join(tmpdir(), "bb source shim "));
    try {
      const bin = join(root, "apps", "cli", "bin");
      const dist = join(root, "apps", "cli", "dist");
      mkdirSync(bin, { recursive: true });
      mkdirSync(dist);
      copyFileSync(resolve("bin/bb.cmd"), join(bin, "bb.cmd"));
      writeFileSync(join(root, "corepack.cmd"), "@exit /b 9\r\n");
      const run = () =>
        spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `& '${join(bin, "bb.cmd").replaceAll("'", "''")}'; exit $LASTEXITCODE`,
          ],
          {
            env: { ...process.env, PATH: `${root};${process.env.PATH}` },
            encoding: "utf8",
            windowsHide: true,
            timeout: 15_000,
          },
        );
      const missing = run();
      expect(missing.error).toBeUndefined();
      expect(missing.status).toBe(1);
      writeFileSync(
        join(dist, "index.js"),
        'console.log("SOURCE_CLI"); process.exitCode = 7;',
      );
      const ready = run();
      expect(ready.error).toBeUndefined();
      expect(ready.status).toBe(7);
      expect(ready.stdout.trim()).toBe("SOURCE_CLI");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("runs the packaged CLI without chunks and never falls back to the daemon", () => {
    const root = mkdtempSync(join(tmpdir(), "bb shim "));
    try {
      const dist = join(root, "dist");
      mkdirSync(dist);
      copyFileSync(resolve("bin/bb.cmd"), join(dist, "bb.cmd"));
      writeFileSync(join(dist, "daemon-bundle.mjs"), "");
      writeFileSync(
        join(dist, "index.js"),
        'console.log("WRONG_DAEMON_ENTRY");',
      );
      const run = () =>
        spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `& '${join(dist, "bb.cmd").replaceAll("'", "''")}' 'argument with spaces'; exit $LASTEXITCODE`,
          ],
          { encoding: "utf8", windowsHide: true, timeout: 15_000 },
        );
      const missing = run();
      expect(missing.error).toBeUndefined();
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("Missing packaged bb CLI entry");
      expect(missing.stdout).not.toContain("WRONG_DAEMON_ENTRY");
      writeFileSync(
        join(dist, "bb"),
        "console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;",
      );
      const available = run();
      expect(available.error).toBeUndefined();
      expect(available.status).toBe(7);
      expect(JSON.parse(available.stdout.trim())).toEqual([
        "argument with spaces",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
