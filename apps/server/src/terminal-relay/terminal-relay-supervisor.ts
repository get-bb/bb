import { fork, type ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import { calculateExponentialBackoffDelay } from "@bb/domain";
import type { Logger } from "@bb/logger";
import {
  terminalRelayToMainMessageSchema,
  type MainToTerminalRelayMessage,
  type TerminalRelayToMainMessage,
} from "./terminal-relay-ipc.js";

export type TerminalRelaySupervisorOptions = {
  backoff?: {
    initialDelayMs: number;
    maxDelayMs: number;
    stableRuntimeMs: number;
  };
  entryPath: string;
  env: NodeJS.ProcessEnv;
  execArgv: string[];
  execPath: string;
  logger: Pick<Logger, "warn">;
  onMessage(message: TerminalRelayToMainMessage): void;
  onRestart(): void;
};

export class TerminalRelaySupervisor {
  private child: ChildProcess | null = null;
  private ready = false;
  private stopped = true;
  private crashes = 0;
  private launchedAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private firstReady: ((value: void) => void) | null = null;
  private readonly backoff;

  constructor(private readonly options: TerminalRelaySupervisorOptions) {
    this.backoff = options.backoff ?? {
      initialDelayMs: 250,
      maxDelayMs: 10_000,
      stableRuntimeMs: 30_000,
    };
  }

  start(): Promise<void> {
    if (!this.stopped) return Promise.resolve();
    this.stopped = false;
    return new Promise<void>((resolve) => {
      this.firstReady = resolve;
      this.spawn();
    });
  }

  private spawn(): void {
    if (this.stopped) return;
    const child = fork(this.options.entryPath, [], {
      env: this.options.env,
      execArgv: this.options.execArgv,
      execPath: this.options.execPath,
      serialization: "json",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    this.child = child;
    this.ready = false;
    this.launchedAt = Date.now();
    child.on("message", (raw: unknown) => {
      const result = terminalRelayToMainMessageSchema.safeParse(raw);
      if (!result.success) {
        this.options.logger.warn(
          { error: result.error },
          "Invalid terminal relay message",
        );
        return;
      }
      if (child !== this.child) return;
      if (result.data.type === "ready") {
        this.ready = true;
        this.firstReady?.();
        this.firstReady = null;
        this.options.onRestart();
      }
      this.options.onMessage(result.data);
    });
    child.on("error", (error) => {
      this.options.logger.warn({ err: error }, "Terminal relay process error");
    });
    child.on("exit", (code, signal) => {
      if (child !== this.child) return;
      this.child = null;
      this.ready = false;
      if (this.stopped) return;
      const uptime = Date.now() - this.launchedAt;
      this.crashes =
        uptime >= this.backoff.stableRuntimeMs ? 1 : this.crashes + 1;
      const delayMs = calculateExponentialBackoffDelay({
        attempt: this.crashes,
        baseDelayMs: this.backoff.initialDelayMs,
        maxDelayMs: this.backoff.maxDelayMs,
      });
      this.options.logger.warn(
        { code, signal, delayMs },
        "Terminal relay exited; restarting",
      );
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.spawn();
      }, delayMs);
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  send(message: MainToTerminalRelayMessage, handle?: Socket): boolean {
    if (!this.ready || !this.child?.connected) return false;
    try {
      if (handle) this.child.send(message, handle, { keepOpen: false });
      else this.child.send(message);
      return true;
    } catch (error) {
      this.options.logger.warn(
        { err: error },
        "Could not send terminal relay message",
      );
      return false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill(), 1_000);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.connected) child.send({ type: "shutdown" });
      else child.kill();
    });
  }
}
