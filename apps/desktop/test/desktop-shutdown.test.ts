import { describe, expect, it } from "vitest";
import {
  registerDesktopShutdownSignalHandlers,
  type DesktopSignalListener,
  type DesktopSignalProcess,
  type DesktopShutdownSignal,
} from "../src/desktop-shutdown.js";

class FakeSignalProcess implements DesktopSignalProcess {
  private listeners: Record<DesktopShutdownSignal, DesktopSignalListener[]> = {
    SIGINT: [],
    SIGTERM: [],
  };

  emit(signal: DesktopShutdownSignal): void {
    for (const listener of this.listeners[signal]) {
      listener();
    }
  }

  on(signal: DesktopShutdownSignal, listener: DesktopSignalListener): void {
    this.listeners[signal].push(listener);
  }
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, 0);
  });
}

describe("desktop shutdown supervision", () => {
  it.each([
    ["SIGINT", "SIGTERM", 130],
    ["SIGTERM", "SIGINT", 143],
  ] as const)(
    "stops the owned runtime before quitting once on %s",
    async (first, second, expectedExitCode) => {
      const fakeProcess = new FakeSignalProcess();
      const calls: string[] = [];
      let exitCode: number | null = null;

      registerDesktopShutdownSignalHandlers({
        exitProcess(code) {
          exitCode = code;
        },
        processEvents: fakeProcess,
        quitApplication() {
          calls.push("quit");
        },
        async stopOwnedRuntime() {
          calls.push("stop");
        },
      });

      fakeProcess.emit(first);
      await flushPromises();
      fakeProcess.emit(second);
      await flushPromises();

      expect(calls).toEqual(["stop", "quit"]);
      expect(exitCode).toBe(expectedExitCode);
    },
  );
});
