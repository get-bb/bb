import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

/**
 * The bootstrap is the only thing standing between a plugin's exported bridge
 * and a live process, so what it does with a bad artifact matters as much as
 * what it does with a good one: a bridge that never answers is invisible, and
 * the message here is the whole diagnosis.
 */

const workerEntry = fileURLToPath(
  new URL("./bridge-worker-entry.ts", import.meta.url),
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createFixture(bridgeSource: string): Promise<{
  bridgeModulePath: string;
  dataDir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "bb-bridge-bootstrap-"));
  tempDirs.push(dir);
  const bridgeModulePath = join(dir, "artifact.mjs");
  await writeFile(bridgeModulePath, bridgeSource);
  return { bridgeModulePath, dataDir: dir };
}

function runWorker(args: string[], stdin: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--conditions=source",
          "--import",
          import.meta.resolve("tsx"),
          workerEntry,
          ...args,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.stdin.end(stdin);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

it("starts an exported bridge with its plugin-scoped directories", async () => {
  const fixture = await createFixture(
    [
      "let context = null;",
      "export const experimental_providerBridge = {",
      "  experimental_apiVersion: 1,",
      "  start(value) { context = value; },",
      "  handleLine(line) {",
      "    process.stdout.write(JSON.stringify({ line, context }) + '\\n');",
      "  },",
      "};",
    ].join("\n"),
  );

  const result = await runWorker(
    [fixture.bridgeModulePath, "provider-fixture", fixture.dataDir],
    '{"hello":true}\n',
  );

  expect(result.code).toBe(0);
  const reported = JSON.parse(result.stdout.trim()) as {
    line: string;
    context: { pluginId: string; dataDir: string; tempDir: string };
  };
  expect(reported.line).toBe('{"hello":true}');
  expect(reported.context.pluginId).toBe("provider-fixture");
  expect(reported.context.dataDir).toBe(fixture.dataDir);
  expect(reported.context.tempDir).toContain("provider-fixture");
  // The temp dir belongs to the process, so nothing of it outlives the exit.
  expect(existsSync(reported.context.tempDir)).toBe(false);
});

it("refuses an artifact with no bridge export, naming the plugin", async () => {
  const fixture = await createFixture("export default { notABridge: true };\n");

  const result = await runWorker(
    [fixture.bridgeModulePath, "provider-fixture", fixture.dataDir],
    "",
  );

  expect(result.code).toBe(1);
  expect(result.stderr).toContain('plugin "provider-fixture"');
  expect(result.stderr).toContain("experimental_providerBridge");
});

it("refuses a bridge export from an unsupported api version", async () => {
  const fixture = await createFixture(
    "export const experimental_providerBridge = { experimental_apiVersion: 99, handleLine() {} };\n",
  );

  const result = await runWorker(
    [fixture.bridgeModulePath, "provider-fixture", fixture.dataDir],
    "",
  );

  expect(result.code).toBe(1);
  expect(result.stderr).toContain("unsupported apiVersion 99");
});

it("reports a bridge module that fails to load", async () => {
  const fixture = await createFixture("throw new Error('boom at import');\n");

  const result = await runWorker(
    [fixture.bridgeModulePath, "provider-fixture", fixture.dataDir],
    "",
  );

  expect(result.code).toBe(1);
  expect(result.stderr).toContain(
    'plugin "provider-fixture" failed to load its provider bridge',
  );
  expect(result.stderr).toContain("boom at import");
});

it("hands a bridge only what it declares: no start hook, no context", async () => {
  const fixture = await createFixture(
    [
      "export const experimental_providerBridge = {",
      "  experimental_apiVersion: 1,",
      "  handleLine(line) { process.stdout.write(line + '\\n'); },",
      "  onClose() { process.stdout.write('closed\\n'); },",
      "};",
    ].join("\n"),
  );

  const result = await runWorker(
    [fixture.bridgeModulePath, "provider-fixture", fixture.dataDir],
    "one\ntwo\n",
  );

  expect(result.stdout).toBe("one\ntwo\nclosed\n");
  expect(await readFile(fixture.bridgeModulePath, "utf8")).toContain(
    "experimental_providerBridge",
  );
});
