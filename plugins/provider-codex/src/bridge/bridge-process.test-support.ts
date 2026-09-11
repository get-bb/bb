import { existsSync, readFileSync, rmSync } from "node:fs";
import type { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";

type BridgeJsonRpcTestHarness = ReturnType<
  typeof createBridgeJsonRpcTestHarness
>;

const PROCESS_POLL_INTERVAL_MS = 20;

function readProcessLog(processLogPath: string): string {
  if (!existsSync(processLogPath)) {
    return "";
  }
  try {
    return readFileSync(processLogPath, "utf8");
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function spawnedAppServerPids(processLogPath: string): number[] {
  return readProcessLog(processLogPath)
    .split("\n")
    .filter((line) => line.startsWith("spawn:"))
    .map((line) => Number(line.split(":")[1]))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ESRCH") {
      return false;
    }
    throw error;
  }
}

export async function waitForAppServerChildrenToExit(
  processLogPath: string,
  timeoutMs = 8_000,
): Promise<void> {
  const childPids = spawnedAppServerPids(processLogPath);
  const deadline = Date.now() + timeoutMs;
  while (childPids.some(processIsAlive)) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for app-server children to exit: ${JSON.stringify(childPids.filter(processIsAlive))}`,
      );
    }
    await new Promise((resolveTick) =>
      setTimeout(resolveTick, PROCESS_POLL_INTERVAL_MS),
    );
  }
}

export async function waitForAppServerProcessStep(
  processLogPath: string,
  step: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readProcessLog(processLogPath).includes(`${step}:`)) {
      return;
    }
    await new Promise((resolveTick) =>
      setTimeout(resolveTick, PROCESS_POLL_INTERVAL_MS),
    );
  }
  throw new Error(`Timed out waiting for app-server process step: ${step}`);
}

export async function cleanupBridgeProcessTest(args: {
  harness: BridgeJsonRpcTestHarness | undefined;
  cleanupId: number;
  threadId: string;
  providerThreadId: string;
  processLogPath: string;
  workspaceDir: string;
  unstubEnvs: () => void;
}): Promise<void> {
  const errors: unknown[] = [];
  if (args.harness !== undefined) {
    try {
      args.harness.sendRequest(args.cleanupId, "thread/stop", {
        threadId: args.threadId,
        providerThreadId: args.providerThreadId,
        intent: "release",
        activeTurnId: null,
      });
      await args.harness.waitForResponse(args.cleanupId).catch(() => undefined);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await waitForAppServerChildrenToExit(args.processLogPath);
  } catch (error) {
    errors.push(error);
  }
  try {
    args.harness?.restore();
  } catch (error) {
    errors.push(error);
  }
  try {
    args.unstubEnvs();
  } catch (error) {
    errors.push(error);
  }
  try {
    if (args.workspaceDir !== "") {
      rmSync(args.workspaceDir, { recursive: true, force: true });
    }
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Bridge process test cleanup failed");
  }
}
