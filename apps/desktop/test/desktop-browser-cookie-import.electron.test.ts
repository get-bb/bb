import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const electronPath: string = require("electron");
import { build } from "esbuild";
import { expect, it } from "vitest";

it("imports normalized cookies and preserves real session state on unsafe or failed transactions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-electron-cookie-test-"));
  const output = join(directory, "probe.cjs");
  try {
    await build({
      bundle: true,
      conditions: ["source"],
      entryPoints: [
        join(__dirname, "desktop-browser-cookie-import.electron-probe.ts"),
      ],
      external: ["electron"],
      format: "cjs",
      outfile: output,
      platform: "node",
      target: "node24",
    });
    const result = JSON.parse(
      execFileSync(electronPath, [output], {
        cwd: __dirname,
        encoding: "utf8",
        timeout: 45_000,
      }),
    );
    expect(result).toEqual({
      finalCookies: [
        { httpOnly: true, name: "session", value: "imported" },
      ],
      importedCount: 1,
      rollbackRestored: true,
      invalidStagingPreservedDestination: true,
      activeWritersRejected: true,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
