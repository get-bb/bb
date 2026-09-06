import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";

const electronPath: string = require("electron");

it.each(["same-origin", "remote", "mixed"])(
  "routes hidden %s frame input without exposing a window or reusing stale contexts",
  async (mode) => {
    const directory = mkdtempSync(join(tmpdir(), "bb-browser-frames-"));
    try {
      const output = join(directory, "fixture.cjs");
      await build({
        bundle: true,
        conditions: ["source"],
        entryPoints: [
          join(__dirname, "desktop-browser-frames.electron-fixture.ts"),
        ],
        external: ["electron"],
        format: "cjs",
        outfile: output,
        platform: "node",
        target: "node24",
      });
      const stdout = execFileSync(electronPath, [output, mode], {
        cwd: __dirname,
        encoding: "utf8",
        timeout: 45_000,
      });
      expect(JSON.parse(stdout)).toMatchObject({
        nativeFrameSmoke: "passed",
        mode,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
