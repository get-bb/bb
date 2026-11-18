import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProcessLifeline } from "@bb/test-helpers";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseStartBbArgs,
  runNativeModulePreflight,
} from "../../../scripts/start-bb.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..");
const startBbUrl = pathToFileURL(
  resolve(repoRoot, "scripts/start-bb.mjs"),
).href;
const spawnedChildren = [];
const lifelines = [];
const scratchDirs = [];

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

async function expectSignalStopsProcessTree({
  errorLabel,
  expectedPidCount,
  fixtureSource,
}) {
  const lifeline = await createProcessLifeline();
  lifelines.push(lifeline);
  const hold = (label, onHeld) => lifeline.holdSource(label, onHeld);
  const parent = spawn(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      fixtureSource(hold, lifeline.path),
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  spawnedChildren.push(parent);
  const stderrChunks = [];
  parent.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));
  const holders = await lifeline.waitForHolders(expectedPidCount);
  expect(holders.every((holder) => holder.alive())).toBe(true);

  parent.kill("SIGTERM");
  const [code, signal] = await waitForExit(parent, 10_000);
  if (code !== 0 || signal !== null) {
    throw new Error(
      `Expected clean fixture exit, got code=${String(code)} signal=${String(signal)} stderr=${stderrChunks.join("")}`,
    );
  }
  await Promise.all(holders.map((holder) => holder.exited));
  expect(lifeline.holders).toHaveLength(expectedPidCount);
}

const idle = "setInterval(() => {}, 1000);";

function spawnHolderSource(hold, leader, child) {
  return `${hold(leader)} process.getBuiltinModule("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(`${hold(child)} ${idle}`)}], { stdio: "inherit" }); ${idle}`;
}

afterEach(async () => {
  for (const child of spawnedChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  await Promise.all(lifelines.splice(0).map((lifeline) => lifeline.close()));
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
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

  it("uses a fresh process after a native binary changes", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "bb-native-preflight-"));
    scratchDirs.push(fixtureRoot);
    const binaryPath = join(fixtureRoot, "native-binary.txt");
    const observationsPath = join(fixtureRoot, "observations.txt");
    const scriptPath = join(fixtureRoot, "verify-native.mjs");
    writeFileSync(
      scriptPath,
      [
        'import { appendFileSync, readFileSync } from "node:fs";',
        `const binaryPath = ${JSON.stringify(binaryPath)};`,
        `const observationsPath = ${JSON.stringify(observationsPath)};`,
        "globalThis.bbFixtureProcessId ??= crypto.randomUUID();",
        'appendFileSync(observationsPath, `${globalThis.bbFixtureProcessId}:${readFileSync(binaryPath, "utf8")}\\n`);',
      ].join("\n"),
    );

    writeFileSync(binaryPath, "abi-137");
    await runNativeModulePreflight({ cwd: fixtureRoot, scriptPath });
    writeFileSync(binaryPath, "abi-127");
    await runNativeModulePreflight({ cwd: fixtureRoot, scriptPath });

    const observations = readFileSync(observationsPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(":"));
    expect(observations).toEqual([
      [expect.any(String), "abi-137"],
      [expect.any(String), "abi-127"],
    ]);
    expect(observations[0][0]).not.toBe(observations[1][0]);
  });

  const posixIt = process.platform === "win32" ? it.skip : it;
  posixIt(
    "stops the build leader and grandchild after direct SIGTERM",
    async () => {
      const fixtureSource = (hold) =>
        [
          `import { runBuildProcess } from ${JSON.stringify(startBbUrl)};`,
          "const result = await runBuildProcess({",
          "  command: process.execPath,",
          `  args: ["-e", ${JSON.stringify(spawnHolderSource(hold, "leader", "grandchild"))}],`,
          `  cwd: ${JSON.stringify(repoRoot)},`,
          "  env: process.env,",
          "});",
          "process.exitCode = result.code ?? (result.signal === null ? 1 : 0);",
        ].join("\n");
      await expectSignalStopsProcessTree({
        errorLabel: "start-bb fixture",
        expectedPidCount: 2,
        fixtureSource,
      });
    },
    20_000,
  );

  posixIt(
    "stops a blocked native repair process group after SIGTERM",
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), "bb-native-signal-"));
      scratchDirs.push(fixtureRoot);
      const scriptPath = join(fixtureRoot, "blocked-repair.mjs");
      const fixtureSource = (hold) => {
        writeFileSync(
          scriptPath,
          [
            'import { execFileSync } from "node:child_process";',
            hold(
              "repair",
              `execFileSync(process.execPath, ["-e", ${JSON.stringify(spawnHolderSource(hold, "leader", "grandchild"))}], { stdio: "inherit" });`,
            ),
          ].join("\n"),
        );
        return [
          `import { runNativeModulePreflight } from ${JSON.stringify(startBbUrl)};`,
          "try {",
          "  await runNativeModulePreflight({",
          `    cwd: ${JSON.stringify(fixtureRoot)},`,
          `    scriptPath: ${JSON.stringify(scriptPath)},`,
          "  });",
          "} catch (error) {",
          '  if (!(error instanceof Error) || !error.message.includes("stopped by SIGTERM")) throw error;',
          "}",
        ].join("\n");
      };
      await expectSignalStopsProcessTree({
        errorLabel: "native preflight fixture",
        expectedPidCount: 3,
        fixtureSource,
      });
    },
    20_000,
  );
});
