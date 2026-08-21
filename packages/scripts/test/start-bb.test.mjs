import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseStartBbArgs } from "../../../scripts/start-bb.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..");
const startBbUrl = pathToFileURL(
  resolve(repoRoot, "scripts/start-bb.mjs"),
).href;
const spawnedPids = [];

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for process state");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

async function readFirstLine(stream) {
  let buffered = "";
  for await (const chunk of stream) {
    buffered += String(chunk);
    const newlineIndex = buffered.indexOf("\n");
    if (newlineIndex !== -1) {
      return buffered.slice(0, newlineIndex).trim();
    }
  }
  throw new Error("Process stdout ended before a line was written");
}

async function waitForExit(child, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      once(child, "exit"),
      new Promise((_, rejectPromise) => {
        timeout = setTimeout(
          () => rejectPromise(new Error("start-bb fixture did not stop")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

afterEach(async () => {
  for (const pid of spawnedPids.splice(0)) {
    if (isAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
  }
});

describe("start-bb", () => {
  it("keeps the worktree policy marker out of bb-app arguments", () => {
    expect(
      parseStartBbArgs(["--worktree-runtime-policy", "--server-port", "4000"]),
    ).toEqual({
      cliArgs: ["--server-port", "4000"],
      useWorktreeRuntimePolicy: true,
    });
    expect(parseStartBbArgs(["--server-port", "4000"])).toEqual({
      cliArgs: ["--server-port", "4000"],
      useWorktreeRuntimePolicy: false,
    });
  });

  const posixIt = process.platform === "win32" ? it.skip : it;
  posixIt(
    "stops the build leader and grandchild after direct SIGTERM",
    async () => {
      const fixtureSource = [
        `import { runBuildProcess } from ${JSON.stringify(startBbUrl)};`,
        "const result = await runBuildProcess({",
        '  command: "sh",',
        "  args: [",
        '    "-c",',
        '    "sleep 300 & grandchild=$!; echo \\\"$$ $grandchild\\\"; wait \\\"$grandchild\\\"",',
        "  ],",
        `  cwd: ${JSON.stringify(repoRoot)},`,
        "  env: process.env,",
        "});",
        "process.exitCode = result.code ?? (result.signal === null ? 1 : 0);",
      ].join("\n");
      const parent = spawn(
        process.execPath,
        [
          "--conditions=source",
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          fixtureSource,
        ],
        {
          cwd: repoRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      if (parent.pid === undefined) {
        throw new Error("start-bb fixture did not receive a pid");
      }
      spawnedPids.push(parent.pid);
      const stderrChunks = [];
      parent.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));
      const [leaderPid, grandchildPid] = (await readFirstLine(parent.stdout))
        .split(" ")
        .map(Number);
      spawnedPids.push(leaderPid, grandchildPid);
      expect(isAlive(leaderPid)).toBe(true);
      expect(isAlive(grandchildPid)).toBe(true);

      parent.kill("SIGTERM");
      const [code, signal] = await waitForExit(parent, 10_000);
      if (code !== 0 || signal !== null) {
        throw new Error(
          `Expected clean fixture exit, got code=${String(code)} signal=${String(signal)} stderr=${stderrChunks.join("")}`,
        );
      }
      await waitFor(
        () => !isAlive(leaderPid) && !isAlive(grandchildPid),
        5_000,
      );
    },
    20_000,
  );
});
