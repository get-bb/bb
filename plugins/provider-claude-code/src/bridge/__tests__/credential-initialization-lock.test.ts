import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeCredentialInitializationCoordinator } from "../credential-initialization-lock.js";

const CHILD_PATH = fileURLToPath(
  new URL("./credential-initialization-lock.child.ts", import.meta.url),
);
const ENTER_TIMEOUT_MS = 5_000;

interface LockWorker {
  child: ChildProcess;
  entered: Promise<void>;
}

function waitForMessage(
  child: ChildProcess,
  expectedType: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child message ${expectedType}`));
    }, ENTER_TIMEOUT_MS);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Lock worker exited before ${expectedType} (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    };
    const onMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === expectedType
      ) {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
    };
    child.on("error", onError);
    child.on("exit", onExit);
    child.on("message", onMessage);
  });
}

function startWorker(args: {
  configDir: string;
  homeDir: string;
  lockRoot: string;
  platform?: NodeJS.Platform;
}): LockWorker {
  const child = fork(
    CHILD_PATH,
    [args.lockRoot, args.homeDir, args.configDir, args.platform ?? "linux"],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  return { child, entered: waitForMessage(child, "entered") };
}

function settlesWithin(
  promise: Promise<void>,
  durationMs: number,
): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), durationMs),
    ),
  ]);
}

async function releaseWorker(worker: LockWorker): Promise<void> {
  const leaving = waitForMessage(worker.child, "leaving");
  worker.child.send("release");
  await leaving;
  await new Promise<void>((resolve) =>
    worker.child.once("exit", () => resolve()),
  );
}

describe("Claude credential initialization coordination", () => {
  let tempRoot: string;
  const workers: LockWorker[] = [];

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-claude-credential-lock-"));
  });

  afterEach(async () => {
    for (const worker of workers) {
      if (!worker.child.killed) worker.child.kill("SIGKILL");
    }
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve) => {
            if (
              worker.child.exitCode !== null ||
              worker.child.signalCode !== null
            ) {
              resolve();
              return;
            }
            worker.child.once("exit", () => resolve());
          }),
      ),
    );
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("serializes separate workers that share a credential store", async () => {
    const homeDir = join(tempRoot, "home");
    const configDir = join(homeDir, ".claude");
    const lockRoot = join(tempRoot, "locks");
    await mkdir(configDir, { recursive: true });

    const first = startWorker({ configDir: ".claude", homeDir, lockRoot });
    workers.push(first);
    await first.entered;

    const second = startWorker({ configDir, homeDir, lockRoot });
    workers.push(second);
    expect(await settlesWithin(second.entered, 250)).toBe(false);

    await releaseWorker(first);
    await second.entered;
    await releaseWorker(second);
  });

  it("does not serialize separate credential stores", async () => {
    const homeDir = join(tempRoot, "home");
    const firstConfigDir = join(tempRoot, "claude-a");
    const secondConfigDir = join(tempRoot, "claude-b");
    const lockRoot = join(tempRoot, "locks");
    await Promise.all([
      mkdir(firstConfigDir, { recursive: true }),
      mkdir(secondConfigDir, { recursive: true }),
    ]);

    const first = startWorker({ configDir: firstConfigDir, homeDir, lockRoot });
    const second = startWorker({
      configDir: secondConfigDir,
      homeDir,
      lockRoot,
    });
    workers.push(first, second);
    await Promise.all([first.entered, second.entered]);
    await Promise.all([releaseWorker(first), releaseWorker(second)]);
  });

  it("does not coordinate sessions with explicit credentials", async () => {
    const coordinator = createClaudeCredentialInitializationCoordinator({
      lockRoot: join(tempRoot, "locks"),
      platform: "linux",
    });
    let releaseFirst: (() => void) | undefined;
    let reportFirstEntered: (() => void) | undefined;
    const firstEntered = new Promise<void>((resolve) => {
      reportFirstEntered = resolve;
    });
    const first = coordinator.run(
      { HOME: join(tempRoot, "home"), ANTHROPIC_API_KEY: "test-api-key-a" },
      async () => {
        reportFirstEntered?.();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      },
    );
    await firstEntered;

    let secondEntered = false;
    await coordinator.run(
      { HOME: join(tempRoot, "home"), ANTHROPIC_API_KEY: "test-api-key-b" },
      async () => {
        secondEntered = true;
      },
    );
    expect(secondEntered).toBe(true);

    releaseFirst?.();
    await first;
  });

  it("treats the macOS Keychain as one store across config directories", async () => {
    const homeDir = join(tempRoot, "home");
    const lockRoot = join(tempRoot, "locks");
    const first = startWorker({
      configDir: join(tempRoot, "claude-a"),
      homeDir,
      lockRoot,
      platform: "darwin",
    });
    workers.push(first);
    await first.entered;

    const second = startWorker({
      configDir: join(tempRoot, "claude-b"),
      homeDir,
      lockRoot,
      platform: "darwin",
    });
    workers.push(second);
    expect(await settlesWithin(second.entered, 250)).toBe(false);

    await releaseWorker(first);
    await second.entered;
    await releaseWorker(second);
  });

  it("recovers a stale lock after a worker crashes", async () => {
    const homeDir = join(tempRoot, "home");
    const configDir = join(homeDir, ".claude");
    const lockRoot = join(tempRoot, "locks");
    await mkdir(configDir, { recursive: true });

    const crashed = startWorker({ configDir, homeDir, lockRoot });
    workers.push(crashed);
    await crashed.entered;
    crashed.child.kill("SIGKILL");
    await new Promise<void>((resolve) =>
      crashed.child.once("exit", () => resolve()),
    );

    const replacement = startWorker({ configDir, homeDir, lockRoot });
    workers.push(replacement);
    await replacement.entered;
    await releaseWorker(replacement);
  });
});
