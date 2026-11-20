import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const setupModule = new URL("../../../vitest.global-tmpdir.ts", import.meta.url)
  .href;

const bases: string[] = [];

afterEach(() => {
  for (const base of bases.splice(0)) {
    rmSync(base, { recursive: true, force: true });
  }
});

function runSetupInChild(env: NodeJS.ProcessEnv): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  const script = `
    import { existsSync } from "node:fs";
    import { tmpdir } from "node:os";
    const { default: setup } = await import(${JSON.stringify(setupModule)});
    const teardown = setup();
    const root = process.env.TMPDIR;
    console.log(JSON.stringify({
      TEMP: process.env.TEMP === root,
      TMP: process.env.TMP === root,
      tmpdir: tmpdir() === root,
    }));
    await teardown();
    console.log(JSON.stringify({
      TMPDIR: process.env.TMPDIR ?? null,
      TEMP: process.env.TEMP ?? null,
      TMP: process.env.TMP ?? null,
      rootRemoved: !existsSync(root),
    }));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ stdout, stderr, code }));
  });
}

it("points TMPDIR, TEMP and TMP at the sandbox, then restores each one", async () => {
  const base = mkdtempSync(join(tmpdir(), "bb-global-tmpdir-test-"));
  bases.push(base);
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: base, TEMP: base };
  delete env.TMP;
  const run = await runSetupInChild(env);
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);
  expect(
    run.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toEqual([
    { TEMP: true, TMP: true, tmpdir: true },
    { TMPDIR: base, TEMP: base, TMP: null, rootRemoved: true },
  ]);
  expect(readdirSync(base).filter((name) => name.startsWith("bb-vt-"))).toEqual(
    [],
  );
});
