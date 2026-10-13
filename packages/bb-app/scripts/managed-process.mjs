import { execFile } from "node:child_process";

const PROCESS_GROUP_POLL_INTERVAL_MS = 10;
const TASKKILL_TIMEOUT_MS = 2_000;

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function hasExited(childProcess) {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

function waitForProcessExit(childProcess) {
  if (hasExited(childProcess)) return Promise.resolve();
  return new Promise((resolvePromise) => {
    childProcess.once("exit", resolvePromise);
  });
}

function stopWindowsProcessTree(pid) {
  return new Promise((resolvePromise) => {
    execFile(
      "taskkill",
      ["/pid", String(pid), "/T", "/F"],
      { timeout: TASKKILL_TIMEOUT_MS, windowsHide: true },
      () => resolvePromise(),
    );
  });
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ESRCH")
    ) {
      throw error;
    }
  }
}

function isProcessGroupRunning(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "EPERM")
    ) {
      return false;
    }
    throw error;
  }
}

async function waitForProcessGroupExit(pid) {
  while (isProcessGroupRunning(pid)) {
    await delay(PROCESS_GROUP_POLL_INTERVAL_MS);
  }
}

export function createManagedProcessStop(stopTimeoutMs) {
  return async function stopManagedProcess(processRef) {
    if (processRef.detached) {
      signalProcessGroup(processRef.childProcess.pid, "SIGINT");
      const processGroupExit = waitForProcessGroupExit(
        processRef.childProcess.pid,
      );
      const stopped = await Promise.race([
        processGroupExit.then(() => true),
        delay(stopTimeoutMs).then(() => false),
      ]);
      if (!stopped) {
        signalProcessGroup(processRef.childProcess.pid, "SIGTERM");
        await processGroupExit;
      }
      return;
    }

    if (hasExited(processRef.childProcess)) return;
    const processExit = waitForProcessExit(processRef.childProcess);
    if (process.platform === "win32") {
      await stopWindowsProcessTree(processRef.childProcess.pid);
      if (!hasExited(processRef.childProcess)) {
        processRef.childProcess.kill("SIGKILL");
      }
      await processExit;
      return;
    }
    processRef.childProcess.kill("SIGINT");
    const stopped = await Promise.race([
      processExit.then(() => true),
      delay(stopTimeoutMs).then(() => false),
    ]);
    if (!stopped) {
      processRef.childProcess.kill("SIGTERM");
      await processExit;
    }
  };
}
