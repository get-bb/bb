import { execFile, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "..", "..", "..");
const nodePtyRequire = createRequire(
  join(repoRoot, "apps", "host-daemon", "package.json"),
);
const shellFile = "powershell.exe";
const shellArgs = [
  "-NoLogo",
  "-NoProfile",
  "-NoExit",
  "-Command",
  "chcp 65001 >$null",
];
const stepTimeoutMs = 20_000;
const shellStartupMs = 3_000;
const pollIntervalMs = 100;
const outputTailLength = 1_500;

function sleep(delayMs) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

function outputTail(output) {
  return output.slice(-outputTailLength);
}

async function waitForPattern(getOutput, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const match = getOutput().match(pattern);
    if (match !== null) {
      return match;
    }
    await sleep(pollIntervalMs);
  }
  return null;
}

async function waitForExit(exitPromise, timeoutMs) {
  return await Promise.race([
    exitPromise.then(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
}

async function readTasklist(pid) {
  const { stdout } = await execFileAsync("tasklist.exe", [
    "/FI",
    `PID eq ${String(pid)}`,
    "/FO",
    "CSV",
    "/NH",
  ]);
  return stdout;
}

function tasklistContainsPid(tasklistStdout, pid) {
  return tasklistStdout.includes(`"${String(pid)}"`);
}

async function waitForPidInTasklist(pid, present, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    let stdout = "";
    try {
      stdout = await readTasklist(pid);
    } catch {
      stdout = "";
    }
    if (tasklistContainsPid(stdout, pid) === present) {
      return true;
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

function taskkillTree(pid) {
  try {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } catch {}
}

function spawnShell(nodePty) {
  const pty = nodePty.spawn(shellFile, shellArgs, {
    cols: 80,
    cwd: tmpdir(),
    env: process.env,
    name: "windows-powershell",
    rows: 30,
  });
  let output = "";
  let exited = false;
  const exit = new Promise((resolveExit) => {
    pty.onExit(() => {
      exited = true;
      resolveExit();
    });
  });
  pty.onData((data) => {
    output += data;
  });
  return {
    exit,
    getOutput: () => output,
    isExited: () => exited,
    pid: pty.pid,
    pty,
  };
}

function releasePty(pty) {
  const destroy = pty.destroy;
  if (typeof destroy === "function") {
    try {
      destroy.apply(pty);
    } catch {}
    return;
  }
  if (typeof pty.dispose === "function") {
    try {
      pty.dispose();
    } catch {}
  }
}

async function destroyShell(session) {
  try {
    session.pty.kill();
  } catch {}
  await Promise.race([session.exit, sleep(5_000)]);
  if (typeof session.pid === "number") {
    taskkillTree(session.pid);
    await Promise.race([session.exit, sleep(5_000)]);
  }
  releasePty(session.pty);
}

const results = [];

async function check(name, run) {
  const started = Date.now();
  let session = null;
  try {
    session = await run();
    results.push({ detail: session?.detail ?? "", name, ok: true });
    console.log(
      `PASS ${name} (${String(Date.now() - started)}ms)${session?.detail ? ` ${session.detail}` : ""}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ detail: message, name, ok: false });
    console.log(`FAIL ${name} (${String(Date.now() - started)}ms): ${message}`);
  } finally {
    if (session?.session) {
      await destroyShell(session.session);
    }
  }
}

async function smokeWindowsConpty() {
  if (process.platform !== "win32") {
    throw new Error(
      `The Windows ConPTY smoke requires win32, got ${process.platform}.`,
    );
  }

  let nodePty = null;
  try {
    nodePty = nodePtyRequire("node-pty");
  } catch (error) {
    throw new Error(
      `Could not load node-pty from apps/host-daemon: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const nodePtyVersion = nodePtyRequire("node-pty/package.json").version;
  console.log(
    `Windows ConPTY smoke: node-pty ${nodePtyVersion} spawning ${shellFile} ${shellArgs.join(" ")}`,
  );

  await check("spawn-echo", async () => {
    const session = spawnShell(nodePty);
    try {
      await sleep(shellStartupMs);
      if (session.isExited()) {
        throw new Error(
          `PowerShell exited during startup.\noutput tail:\n${outputTail(session.getOutput())}`,
        );
      }
      session.pty.write("Write-Output ('BB_' + 'WN_OK')\r");
      const match = await waitForPattern(
        session.getOutput,
        /BB_WN_OK/,
        stepTimeoutMs,
      );
      if (match === null) {
        throw new Error(
          `BB_WN_OK never appeared in shell output.\noutput tail:\n${outputTail(session.getOutput())}`,
        );
      }
      return { detail: `pid=${String(session.pid)}`, session };
    } catch (error) {
      await destroyShell(session);
      throw error;
    }
  });

  await check("utf8", async () => {
    const session = spawnShell(nodePty);
    try {
      await sleep(shellStartupMs);
      session.pty.write("Write-Output ('dise' + 'ño ✓')\r");
      const match = await waitForPattern(
        session.getOutput,
        /diseño ✓/,
        stepTimeoutMs,
      );
      if (match === null) {
        throw new Error(
          `UTF-8 round-trip failed: "diseño ✓" never appeared intact (chcp 65001 bootstrap suspect).\noutput tail:\n${outputTail(session.getOutput())}`,
        );
      }
      return { detail: `pid=${String(session.pid)}`, session };
    } catch (error) {
      await destroyShell(session);
      throw error;
    }
  });

  await check("resize", async () => {
    const session = spawnShell(nodePty);
    try {
      await sleep(shellStartupMs);
      session.pty.resize(120, 40);
      await sleep(500);
      session.pty.resize(80, 30);
      await sleep(500);
      if (session.isExited()) {
        throw new Error("PowerShell died after resize.");
      }
      session.pty.write("Write-Output ('BB_WN_' + 'RESIZE_OK')\r");
      const match = await waitForPattern(
        session.getOutput,
        /BB_WN_RESIZE_OK/,
        stepTimeoutMs,
      );
      if (match === null) {
        throw new Error(
          `Shell stopped responding after resize.\noutput tail:\n${outputTail(session.getOutput())}`,
        );
      }
      return { detail: `pid=${String(session.pid)}`, session };
    } catch (error) {
      await destroyShell(session);
      throw error;
    }
  });

  await check("close", async () => {
    const session = spawnShell(nodePty);
    try {
      await sleep(shellStartupMs);
      const pid = session.pid;
      if (typeof pid !== "number") {
        throw new Error("node-pty did not expose a shell PID.");
      }
      session.pty.kill();
      const exited = await waitForExit(session.exit, 10_000);
      if (!exited) {
        throw new Error(`Shell pid ${String(pid)} ignored pty.kill().`);
      }
      await sleep(1_000);
      const stdout = await readTasklist(pid);
      if (tasklistContainsPid(stdout, pid)) {
        taskkillTree(pid);
        throw new Error(
          `Shell pid ${String(pid)} survived pty.kill() and is still in tasklist (zombie). tasklist:\n${stdout.trim()}`,
        );
      }
      releasePty(session.pty);
      return { detail: `pid=${String(pid)} reaped`, session: null };
    } catch (error) {
      await destroyShell(session);
      throw error;
    }
  });

  await check("tree", async () => {
    const session = spawnShell(nodePty);
    let childPid = null;
    try {
      await sleep(shellStartupMs);
      const parentPid = session.pid;
      if (typeof parentPid !== "number") {
        throw new Error("node-pty did not expose a shell PID.");
      }
      session.pty.write(
        "$bbWnChild = Start-Process -FilePath powershell.exe -ArgumentList '-NoLogo','-NoProfile','-Command','Start-Sleep -Seconds 60' -PassThru; Write-Output ('BB_WN_CHILD_' + $bbWnChild.Id)\r",
      );
      const match = await waitForPattern(
        session.getOutput,
        /BB_WN_CHILD_(\d+)/,
        stepTimeoutMs,
      );
      if (match === null) {
        throw new Error(
          `Shell never reported a child PID.\noutput tail:\n${outputTail(session.getOutput())}`,
        );
      }
      childPid = Number(match[1]);
      const childAppeared = await waitForPidInTasklist(childPid, true, 5_000);
      if (!childAppeared) {
        throw new Error(
          `Child pid ${String(childPid)} never appeared in tasklist; tree assertion would be vacuous.`,
        );
      }
      taskkillTree(parentPid);
      await waitForExit(session.exit, 10_000);
      await sleep(2_000);
      const parentStdout = await readTasklist(parentPid);
      if (tasklistContainsPid(parentStdout, parentPid)) {
        throw new Error(
          `Parent pid ${String(parentPid)} survived taskkill /PID /T /F. tasklist:\n${parentStdout.trim()}`,
        );
      }
      const stdout = await readTasklist(childPid);
      if (tasklistContainsPid(stdout, childPid)) {
        throw new Error(
          `Child pid ${String(childPid)} survived taskkill /T of parent ${String(parentPid)} (zombie). tasklist:\n${stdout.trim()}`,
        );
      }
      releasePty(session.pty);
      return {
        detail: `parent=${String(parentPid)} child=${String(childPid)} reaped`,
        session: null,
      };
    } catch (error) {
      if (childPid !== null) {
        taskkillTree(childPid);
      }
      await destroyShell(session);
      throw error;
    }
  });

  const failures = results.filter((result) => !result.ok);
  console.log(
    `Windows ConPTY smoke: ${String(results.length - failures.length)} passed, ${String(failures.length)} failed.`,
  );
  for (const failure of failures) {
    console.log(`FAILED ${failure.name}: ${failure.detail}`);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await smokeWindowsConpty().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : error;
  console.error(message);
  process.exitCode = 1;
});
