import { Worker } from "node:worker_threads";
import { createDeferredPromise } from "@bb/test-helpers";
import {
  hostDaemonTerminalDataServerMessageSchema,
  type HostDaemonTerminalDataServerMessage,
} from "@bb/host-daemon-contract";
import { createTestDaemonHostKey } from "./test-app.js";

export class FakeDaemonDataSocket {
  private worker: Worker | null = null;
  readonly received: HostDaemonTerminalDataServerMessage[] = [];

  constructor(
    private readonly baseUrl: string,
    private readonly hostId: string,
    private readonly sessionId: string,
  ) {}

  async connect(): Promise<void> {
    const url = new URL(
      `/internal/ws/terminals?sessionId=${encodeURIComponent(this.sessionId)}`,
      this.baseUrl,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const worker = new Worker(
      new URL("./fake-daemon-data-worker.mjs", import.meta.url),
      {
        workerData: {
          url: url.href,
          key: createTestDaemonHostKey({ hostId: this.hostId }),
        },
      },
    );
    this.worker = worker;
    worker.on("message", (data: { type: string; message?: unknown }) => {
      if (data.type === "message")
        this.received.push(
          hostDaemonTerminalDataServerMessageSchema.parse(data.message),
        );
    });
    await this.waitForOpen();
  }

  private waitForOpen(): Promise<void> {
    const worker = this.worker;
    if (!worker) throw new Error("Daemon worker is not running");
    const { promise, resolve, reject } = createDeferredPromise<void>();
    const onMessage = (data: { type: string; error?: string }) => {
      if (data.type === "open") {
        cleanup();
        resolve(undefined);
      } else if (data.type === "error") {
        cleanup();
        reject(new Error(data.error));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
    return promise;
  }

  async reconnect(): Promise<void> {
    if (!this.worker) throw new Error("Daemon worker is not running");
    const opened = this.waitForOpen();
    this.worker.postMessage("reconnect");
    await opened;
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    await worker?.terminate();
  }
}
