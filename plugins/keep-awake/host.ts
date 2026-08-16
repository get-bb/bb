import { spawn } from "node:child_process";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { keepAwakeHostContract } from "./contract.js";
import type { ExperimentalHostSignalPublisher } from "@get-bb/plugin-sdk/host";

const CAFFEINATE_COMMAND = "/usr/bin/caffeinate";
const RESTART_DELAY_MS = 1_000;

interface KeepAwakeChild {
  kill(signal: NodeJS.Signals): boolean;
  once(event: "error" | "exit", listener: () => void): this;
}

export interface KeepAwakeHostDependencies {
  readonly pid: number;
  readonly platform: NodeJS.Platform;
  spawn(
    command: string,
    args: readonly string[],
    options: { readonly stdio: "ignore" },
  ): KeepAwakeChild;
}

/** Dependency-injected factory used by host-entry tests. */
export function createKeepAwakeHostEntry(deps: KeepAwakeHostDependencies) {
  let child: KeepAwakeChild | null = null;
  let lifecycleSignal: AbortSignal | null = null;
  let signalPublisher: ExperimentalHostSignalPublisher<
    typeof keepAwakeHostContract
  > | null = null;
  let desiredEnabled = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function clearRestart(): void {
    if (restartTimer === null) return;
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  function stop(): void {
    const active = child;
    child = null;
    active?.kill("SIGTERM");
  }

  function scheduleRestart(): void {
    if (
      restartTimer !== null ||
      !desiredEnabled ||
      lifecycleSignal?.aborted === true
    ) {
      return;
    }
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
      if (child !== null) signalPublisher?.publish("stateChanged", status());
    }, RESTART_DELAY_MS);
  }

  function start(): void {
    if (
      child !== null ||
      restartTimer !== null ||
      !desiredEnabled ||
      deps.platform !== "darwin" ||
      lifecycleSignal?.aborted === true
    ) {
      return;
    }
    let next: KeepAwakeChild;
    try {
      next = deps.spawn(CAFFEINATE_COMMAND, ["-i", "-w", String(deps.pid)], {
        stdio: "ignore",
      });
    } catch {
      scheduleRestart();
      return;
    }
    child = next;
    const clear = (): void => {
      if (child !== next) return;
      child = null;
      signalPublisher?.publish("stateChanged", status());
      scheduleRestart();
    };
    next.once("error", clear);
    next.once("exit", clear);
  }

  function disposeState(): void {
    desiredEnabled = false;
    clearRestart();
    stop();
  }

  function bindContext(
    signal: AbortSignal,
    signals: ExperimentalHostSignalPublisher<typeof keepAwakeHostContract>,
  ): void {
    signalPublisher = signals;
    if (lifecycleSignal === signal) return;
    lifecycleSignal = signal;
    signal.addEventListener("abort", disposeState, { once: true });
  }

  function status(): { enabled: boolean; supported: boolean } {
    return { enabled: child !== null, supported: deps.platform === "darwin" };
  }

  return experimental_defineHostEntry({
    contract: keepAwakeHostContract,
    handlers: {
      setEnabled(input, context) {
        bindContext(context.lifecycle.signal, context.signals);
        desiredEnabled = deps.platform === "darwin" && input.enabled;
        if (!desiredEnabled) {
          clearRestart();
          stop();
          return status();
        }
        start();
        return status();
      },
      status(_input, context) {
        bindContext(context.lifecycle.signal, context.signals);
        return status();
      },
    },
    dispose() {
      signalPublisher = null;
      disposeState();
    },
  });
}

export default createKeepAwakeHostEntry({
  pid: process.pid,
  platform: process.platform,
  spawn(command, args, options) {
    return spawn(command, [...args], options);
  },
});
