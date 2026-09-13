import os from "node:os";
import type { IPty } from "node-pty";
import { describe, expect, it } from "vitest";
import { resolveWindowsTerminalShell } from "./terminal-manager.js";

const isWindows = process.platform === "win32";

interface TrackedPty {
  exitPromise(timeoutMs: number): Promise<{ exitCode: number }>;
  output(): string;
  waitFor(text: string, timeoutMs: number): Promise<void>;
}

async function spawnWindowsShell(): Promise<{ pty: IPty; tracked: TrackedPty }> {
  const { spawn } = await import("node-pty");
  const shell = await resolveWindowsTerminalShell();
  const pty = spawn(shell, ["-NoLogo", "-NoProfile"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: os.tmpdir(),
    env: process.env,
  });

  let output = "";
  const waiters = new Set<{
    reject: (error: Error) => void;
    resolve: () => void;
    text: string;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let exit: { exitCode: number } | null = null;
  const exitWaiters: {
    reject: (error: Error) => void;
    resolve: (event: { exitCode: number }) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  pty.onData((data) => {
    output += data;
    for (const waiter of [...waiters]) {
      if (output.includes(waiter.text)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }
  });
  pty.onExit((event) => {
    exit = { exitCode: event.exitCode };
    for (const waiter of exitWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`pty exited before output: ${waiter.text}`));
    }
    waiters.clear();
  });

  const tracked: TrackedPty = {
    exitPromise(timeoutMs: number) {
      return new Promise((resolve, reject) => {
        if (exit !== null) {
          resolve(exit);
          return;
        }
        const waiter = {
          reject,
          resolve,
          timer: setTimeout(() => {
            reject(new Error("Timed out waiting for pty exit"));
          }, timeoutMs),
        };
        exitWaiters.push(waiter);
      });
    },
    output: () => output,
    waitFor(text: string, timeoutMs: number) {
      return new Promise<void>((resolve, reject) => {
        if (output.includes(text)) {
          resolve();
          return;
        }
        const waiter = {
          reject,
          resolve,
          text,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            pty.kill();
            reject(
              new Error(
                `Timed out waiting for ${text}; output so far: ${output}`,
              ),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };

  return { pty, tracked };
}

describe("native Windows terminal pty", () => {
  it.skipIf(!isWindows)(
    "drives output, cyrillic input, resize, and clean exit through ConPTY",
    async () => {
      const { pty, tracked } = await spawnWindowsShell();
      let exited = false;
      try {
        await tracked.waitFor(">", 30_000);

        const marker = `${Date.now()}`;
        pty.write(`Write-Output ('МАРК' + 'ЕР_${marker}')\r`);
        await tracked.waitFor(`МАРКЕР_${marker}`, 30_000);

        pty.write("$v = Read-Host ('ПР' + 'ОМС')\r");
        await tracked.waitFor("ПРОМС:", 30_000);
        pty.write("привет терминал\r");
        pty.write('Write-Output ("эхо" + ": $v")\r');
        await tracked.waitFor("эхо: привет терминал", 30_000);

        pty.resize(120, 40);
        pty.write("Write-Output ('РЕСАЙЗ' + '_ОК')\r");
        await tracked.waitFor("РЕСАЙЗ_ОК", 30_000);

        const exitPromise = tracked.exitPromise(30_000);
        pty.write("exit 0\r");
        const exit = await exitPromise;
        expect(exit.exitCode).toBe(0);
        exited = true;
        expect(tracked.output()).toContain(`МАРКЕР_${marker}`);
      } finally {
        if (!exited) {
          pty.kill();
        }
      }
    },
    150_000,
  );

  it.skipIf(!isWindows)(
    "kills a live pty",
    async () => {
      const { pty, tracked } = await spawnWindowsShell();
      let exited = false;
      try {
        await tracked.waitFor(">", 30_000);
        const exitPromise = tracked.exitPromise(30_000);
        pty.kill();
        await exitPromise;
        exited = true;
      } finally {
        if (!exited) {
          pty.kill();
        }
      }
    },
    120_000,
  );
});
