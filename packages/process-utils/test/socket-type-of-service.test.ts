import { spawn } from "node:child_process";
import { once } from "node:events";
import { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { installSocketTypeOfServiceGuard } from "../src/index.js";

const originalDescriptor = Object.getOwnPropertyDescriptor(
  Socket.prototype,
  "setTypeOfService",
);
const runtimeSetsTypeOfService = originalDescriptor !== undefined;

const RESETTING_SERVER_SOURCE = `
const net = require("node:net");
const server = net.createServer((socket) => socket.resetAndDestroy());
server.listen(0, "127.0.0.1", () => process.stdout.write(server.address().port + "\\n"));
`;

function restoreSetTypeOfService(): void {
  if (originalDescriptor === undefined) {
    Reflect.deleteProperty(Socket.prototype, "setTypeOfService");
    return;
  }
  Object.defineProperty(
    Socket.prototype,
    "setTypeOfService",
    originalDescriptor,
  );
}

function defineThrowingSetTypeOfService(code: string): void {
  Object.defineProperty(Socket.prototype, "setTypeOfService", {
    configurable: true,
    writable: true,
    value() {
      throw Object.assign(new Error(`setTypeOfService ${code}`), { code });
    },
  });
}

function setTypeOfService(socket: Socket): unknown {
  return Reflect.apply(Reflect.get(socket, "setTypeOfService"), socket, [0]);
}

function blockEventLoop(durationMs: number): void {
  const until = Date.now() + durationMs;
  while (Date.now() < until) {}
}

describe("installSocketTypeOfServiceGuard", () => {
  afterEach(() => {
    restoreSetTypeOfService();
  });

  it("ignores EINVAL and rethrows other setTypeOfService failures", () => {
    defineThrowingSetTypeOfService("EINVAL");
    installSocketTypeOfServiceGuard();
    const socket = new Socket();
    expect(setTypeOfService(socket)).toBe(socket);

    defineThrowingSetTypeOfService("EPERM");
    installSocketTypeOfServiceGuard();
    expect(() => setTypeOfService(socket)).toThrow("setTypeOfService EPERM");
  });

  it.runIf(runtimeSetsTypeOfService)(
    "rejects fetch when the peer resets the connection before the request is written",
    async () => {
      installSocketTypeOfServiceGuard();
      const server = spawn(process.execPath, ["-e", RESETTING_SERVER_SOURCE], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      try {
        const [portChunk] = await once(server.stdout, "data");
        const request = fetch(`http://127.0.0.1:${String(portChunk).trim()}/`);
        blockEventLoop(300);
        await expect(request).rejects.toThrow("fetch failed");
      } finally {
        server.kill();
      }
    },
  );
});
