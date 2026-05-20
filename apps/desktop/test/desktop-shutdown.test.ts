import { describe, expect, it } from "vitest";
import {
  createDesktopShutdownState,
  handleDesktopShutdownSignal,
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

  off(signal: DesktopShutdownSignal, listener: DesktopSignalListener): void {
    this.listeners[signal] = this.listeners[signal].filter(
      (currentListener) => currentListener !== listener,
    );
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
  it("stops the owned runtime before quitting on SIGTERM", async () => {
    const state = createDesktopShutdownState();
    const calls: string[] = [];
    let exitCode: number | null = null;

    await handleDesktopShutdownSignal({
      exitProcess(code) {
        exitCode = code;
      },
      quitApplication() {
        calls.push("quit");
      },
      signal: "SIGTERM",
      state,
      async stopOwnedRuntime() {
        calls.push("stop");
      },
    });

    expect(calls).toEqual(["stop", "quit"]);
    expect(exitCode).toBe(143);
  });

  it("registers removable SIGINT and SIGTERM handlers", async () => {
    const fakeProcess = new FakeSignalProcess();
    const state = createDesktopShutdownState();
    let stopCount = 0;
    let quitCount = 0;
    let exitCode: number | null = null;

    const registeredHandlers = registerDesktopShutdownSignalHandlers({
      exitProcess(code) {
        exitCode = code;
      },
      processEvents: fakeProcess,
      quitApplication() {
        quitCount += 1;
      },
      state,
      async stopOwnedRuntime() {
        stopCount += 1;
      },
    });

    fakeProcess.emit("SIGINT");
    await flushPromises();
    registeredHandlers.remove();
    fakeProcess.emit("SIGTERM");
    await flushPromises();

    expect(stopCount).toBe(1);
    expect(quitCount).toBe(1);
    expect(exitCode).toBe(130);
  });
});
