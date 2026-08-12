import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBbAppProcessEnv,
  resolveBbAppProcessRuntime,
  startBbAppProcess,
  type BbAppProcess,
} from "../src/bb-process.js";

interface TempScript {
  path: string;
  root: string;
}

interface WaitForLogArgs {
  process: BbAppProcess;
  text: string;
  timeoutMs: number;
}

interface CreateTempScriptArgs {
  contents: string;
}

const tempScripts: TempScript[] = [];
const processes: BbAppProcess[] = [];

async function createTempScript(
  args: CreateTempScriptArgs,
): Promise<TempScript> {
  const root = await mkdtemp(join(tmpdir(), "bb-desktop-process-"));
  const path = join(root, "child.mjs");
  await writeFile(path, args.contents, "utf8");
  const script = { path, root };
  tempScripts.push(script);
  return script;
}

async function waitForLog(args: WaitForLogArgs): Promise<void> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() <= deadline) {
    if (args.process.logs.text().includes(args.text)) {
      return;
    }
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, 10);
    });
  }
  throw new Error(`Timed out waiting for log line: ${args.text}`);
}

afterEach(async () => {
  for (const processEntry of processes.splice(0)) {
    if (
      processEntry.childProcess.exitCode === null &&
      processEntry.childProcess.signalCode === null
    ) {
      processEntry.childProcess.kill("SIGKILL");
      await processEntry.exit;
    }
  }

  while (tempScripts.length > 0) {
    const script = tempScripts.pop();
    if (script !== undefined) {
      await rm(script.root, { force: true, recursive: true });
    }
  }
});

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("bb app process", () => {
  it("stops grandchild processes on win32", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const script = await createTempScript({
      contents: `
import { spawn } from "node:child_process";
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
console.log("grandchild=" + String(grandchild.pid));
console.log("ready");
`,
    });
    const bbProcess = startBbAppProcess({
      bridgePath: script.path,
      cwd: script.root,
      env: process.env,
      logLineLimit: 50,
      runtime: {
        executablePath: process.execPath,
        mode: "node",
      },
    });
    processes.push(bbProcess);
    await waitForLog({ process: bbProcess, text: "ready", timeoutMs: 5_000 });
    const match = /grandchild=(\d+)/u.exec(bbProcess.logs.text());
    const grandchildPid = Number(match?.[1]);
    expect(grandchildPid).toBeGreaterThan(0);
    expect(isPidRunning(grandchildPid)).toBe(true);

    await bbProcess.stop({
      killSignal: "SIGKILL",
      killTimeoutMs: 2_000,
      signal: "SIGTERM",
      timeoutMs: 2_000,
    });

    expect(isPidRunning(grandchildPid)).toBe(false);
  });

  it("uses the dev Node executable without Electron node mode", () => {
    const env = createBbAppProcessEnv({
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
      runtimeMode: "node",
    });

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("uses Electron node mode for packaged runtimes", () => {
    const runtime = resolveBbAppProcessRuntime({
      env: {},
      isPackaged: true,
      processExecPath: "/Applications/bb.app/Contents/MacOS/bb",
    });

    expect(runtime).toEqual({
      executablePath: "/Applications/bb.app/Contents/MacOS/bb",
      mode: "electron-node",
    });
    expect(
      createBbAppProcessEnv({
        env: {},
        runtimeMode: runtime.mode,
      }).ELECTRON_RUN_AS_NODE,
    ).toBe("1");
  });

  it("requires the host Node executable in desktop dev mode", () => {
    expect(() =>
      resolveBbAppProcessRuntime({
        env: {},
        isPackaged: false,
        processExecPath: "/path/to/electron",
      }),
    ).toThrow("BB_DESKTOP_NODE_EXEC_PATH is required");

    expect(
      resolveBbAppProcessRuntime({
        env: {
          BB_DESKTOP_NODE_EXEC_PATH: "/usr/local/bin/node",
        },
        isPackaged: false,
        processExecPath: "/path/to/electron",
      }),
    ).toEqual({
      executablePath: "/usr/local/bin/node",
      mode: "node",
    });
  });

  it("escalates to SIGKILL when the bridge ignores SIGTERM", async () => {
    if (process.platform === "win32") {
      return;
    }
    const script = await createTempScript({
      contents: `
process.on("SIGTERM", () => {
  process.stdout.write("ignored SIGTERM\\n");
});
process.stdout.write("ready\\n");
setInterval(() => undefined, 1000);
`,
    });
    const processEntry = startBbAppProcess({
      bridgePath: script.path,
      cwd: script.root,
      env: process.env,
      logLineLimit: 20,
      runtime: {
        executablePath: process.execPath,
        mode: "node",
      },
    });
    processes.push(processEntry);
    await waitForLog({
      process: processEntry,
      text: "ready",
      timeoutMs: 1_000,
    });

    await processEntry.stop({
      killSignal: "SIGKILL",
      killTimeoutMs: 1_000,
      signal: "SIGTERM",
      timeoutMs: 50,
    });

    const exit = await processEntry.exit;
    expect(processEntry.logs.text()).toContain("ignored SIGTERM");
    expect(exit.signal).toBe("SIGKILL");
  });
});
