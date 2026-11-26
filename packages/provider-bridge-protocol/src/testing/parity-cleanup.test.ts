import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { replayRecording } from "./parity.js";

const mkdtempFailure = vi.hoisted(() => ({
  prefix: null as string | null,
  created: [] as string[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const mkdtempSync = (prefix: string): string => {
    if (
      mkdtempFailure.prefix !== null &&
      prefix.includes(mkdtempFailure.prefix)
    ) {
      throw Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      });
    }
    const dir = actual.mkdtempSync(prefix);
    mkdtempFailure.created.push(dir);
    return dir;
  };
  return { ...actual, default: { ...actual, mkdtempSync }, mkdtempSync };
});

const parityModule = new URL("./parity.ts", import.meta.url).href;
const dirs: string[] = [];

afterEach(() => {
  mkdtempFailure.prefix = null;
  mkdtempFailure.created.length = 0;
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeRecording(dir: string): void {
  const entry = (direction: string, line: string) =>
    `${JSON.stringify({ ts: 1, run: 1, seq: 1, dir: direction, line })}\n`;
  writeFileSync(
    join(dir, "runtime→bridge.ndjson"),
    entry(
      "runtime→bridge",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "thread/start",
        params: {},
      }),
    ),
  );
  writeFileSync(join(dir, "bridge→runtime.current.ndjson"), "");
}

it("removes the replay state dir when allocating the workspace dir fails", async () => {
  const recordingDir = mkdtempSync(join(tmpdir(), "bb-parity-ws-fail-test-"));
  dirs.push(recordingDir);
  writeRecording(recordingDir);
  mkdtempFailure.created.length = 0;
  mkdtempFailure.prefix = "bb-parity-ws-";
  await expect(
    replayRecording({
      recordingDir,
      providerId: "test-provider",
      bridge: {
        command: process.execPath,
        args: ["-e", ""],
        cwd: recordingDir,
        env: {},
      },
      createAssembler: () => ({ assembleMessage: () => [] }),
    }),
  ).rejects.toThrow("ENOSPC");
  const stateDirs = mkdtempFailure.created.filter((dir) =>
    dir.includes("bb-parity-replay-"),
  );
  expect(stateDirs).toHaveLength(1);
  expect(stateDirs.filter((dir) => existsSync(dir))).toEqual([]);
});

it("removes default bridge data dirs when the process exits", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "bb-parity-data-dir-test-"));
  dirs.push(tmp);
  const script = `
    import { readdirSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    const { resolveProviderBridgeLaunch } = await import(${JSON.stringify(parityModule)});
    for (let index = 0; index < 2; index += 1) {
      resolveProviderBridgeLaunch({
        modulePath: join(tmpdir(), "bridge.mjs"),
        bootstrapPath: join(tmpdir(), "bootstrap.mjs"),
        pluginId: "test-plugin",
      });
    }
    console.log(
      "data-dirs:" +
        readdirSync(tmpdir()).filter((name) => name.startsWith("bb-parity-data-")).length,
    );
  `;
  const run = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--conditions=source",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
      ],
      {
        env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
        stdio: ["ignore", "pipe", "pipe"],
      },
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
  expect(run.stderr).toBe("");
  expect(run.stdout.trim()).toBe("data-dirs:2");
  expect(run.code).toBe(0);
  expect(
    readdirSync(tmp).filter((name) => name.startsWith("bb-parity-data-")),
  ).toEqual([]);
});
