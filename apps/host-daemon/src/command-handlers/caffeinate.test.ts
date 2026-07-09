import { describe, expect, it, vi } from "vitest";
import {
  createCaffeinateManager,
  type CaffeinateChildProcess,
} from "./caffeinate.js";

class FakeCaffeinateChild implements CaffeinateChildProcess {
  readonly killedWith: NodeJS.Signals[] = [];
  readonly exitListeners: Array<
    (code: number | null, signal: NodeJS.Signals | null) => void
  > = [];
  readonly errorListeners: Array<(error: Error) => void> = [];
  unrefCount = 0;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedWith.push(signal);
    return true;
  }

  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "exit" | "error",
    listener:
      | ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void),
  ): this {
    if (event === "exit") {
      this.exitListeners.push(
        listener as (
          code: number | null,
          signal: NodeJS.Signals | null,
        ) => void,
      );
    } else {
      this.errorListeners.push(listener as (error: Error) => void);
    }
    return this;
  }

  unref(): void {
    this.unrefCount += 1;
  }

  emitExit(): void {
    for (const listener of this.exitListeners) {
      listener(0, null);
    }
  }

  emitError(): void {
    for (const listener of this.errorListeners) {
      listener(new Error("spawn failed"));
    }
  }
}

describe("caffeinate manager", () => {
  it("starts one caffeinate process bound to the daemon pid and stops it", () => {
    const children: FakeCaffeinateChild[] = [];
    const spawn = vi.fn(() => {
      const child = new FakeCaffeinateChild();
      children.push(child);
      return child;
    });
    const manager = createCaffeinateManager({
      pid: 12345,
      platform: "darwin",
      spawner: { spawn },
    });

    expect(manager.setEnabled(true)).toEqual({
      enabled: true,
      supported: true,
    });
    expect(manager.setEnabled(true)).toEqual({
      enabled: true,
      supported: true,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith("/usr/bin/caffeinate", [
      "-i",
      "-w",
      "12345",
    ]);

    expect(manager.setEnabled(false)).toEqual({
      enabled: false,
      supported: true,
    });
    expect(children[0]?.killedWith).toEqual(["SIGTERM"]);
  });

  it("does not spawn on non-macOS hosts", () => {
    const spawn = vi.fn(() => new FakeCaffeinateChild());
    const manager = createCaffeinateManager({
      platform: "linux",
      spawner: { spawn },
    });

    expect(manager.setEnabled(true)).toEqual({
      enabled: false,
      supported: false,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("clears exited children so a later enable restarts caffeinate", () => {
    const children: FakeCaffeinateChild[] = [];
    const manager = createCaffeinateManager({
      platform: "darwin",
      spawner: {
        spawn() {
          const child = new FakeCaffeinateChild();
          children.push(child);
          return child;
        },
      },
    });

    manager.setEnabled(true);
    children[0]?.emitExit();
    manager.setEnabled(true);

    expect(children).toHaveLength(2);
  });

  it("clears failed children so a later enable restarts caffeinate", () => {
    const children: FakeCaffeinateChild[] = [];
    const manager = createCaffeinateManager({
      platform: "darwin",
      spawner: {
        spawn() {
          const child = new FakeCaffeinateChild();
          children.push(child);
          return child;
        },
      },
    });

    manager.setEnabled(true);
    children[0]?.emitError();
    manager.setEnabled(true);

    expect(children).toHaveLength(2);
  });

  it("kills the child during shutdown", () => {
    const child = new FakeCaffeinateChild();
    const manager = createCaffeinateManager({
      platform: "darwin",
      spawner: { spawn: () => child },
    });

    manager.setEnabled(true);
    manager.shutdown();

    expect(child.killedWith).toEqual(["SIGTERM"]);
  });
});
