import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const electronPath: string = require("electron");
import { build } from "esbuild";
import { expect, it } from "vitest";

it("satisfies the F12 script-safety contract on a real Electron runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-page-runtime-e2e-"));
  const output = join(directory, "fixture.cjs");
  try {
    await build({
      bundle: true,
      entryPoints: [
        join(__dirname, "desktop-browser-page-runtime.electron-fixture.ts"),
      ],
      external: ["electron"],
      format: "cjs",
      outfile: output,
      platform: "node",
      target: "node24",
    });
    const stdout = execFileSync(electronPath, [output], {
      cwd: __dirname,
      encoding: "utf8",
      timeout: 120_000,
    });
    const results: Array<{
      name: string;
      ok: boolean;
      observations: Record<string, unknown>;
    }> = JSON.parse(stdout);
    expect(results.length).toBeGreaterThanOrEqual(4);
    for (const row of results) {
      expect(row.ok, `${row.name}: ${JSON.stringify(row.observations)}`).toBe(
        true,
      );
    }
    const byName = new Map(results.map((row) => [row.name, row.observations]));
    expect(byName.get("busy times out finite; page and unrelated survive")).toMatchObject({
      timedOut: true,
      ticksAdvanced: true,
      unrelated: "3",
    });
    expect(
      byName.get("concurrent newer request survives the older grace kill"),
    ).toMatchObject({ newerSurvived: true });
    expect(
      byName.get("explicit cancel rejects AbortError; page healthy"),
    ).toMatchObject({ outcome: "AbortError", ticksAdvanced: true });
    expect(
      byName.get("isolated world context survives a grace kill"),
    ).toMatchObject({
      outcome: "Error",
      freshResult: JSON.stringify({ ok: "after-kill-fresh" }),
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
