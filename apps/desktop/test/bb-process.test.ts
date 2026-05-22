import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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

async function createTempScript(args: CreateTempScriptArgs): Promise<TempScript> {
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

describe("bb app process", () => {
  it("escalates to SIGKILL when the bridge ignores SIGTERM", async () => {
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
