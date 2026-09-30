import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket as NodeWebSocket } from "ws";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";
import { TunnelSession } from "../src/session.js";

class FakeTunnel extends EventEmitter {
  readonly readyState = 1;
  readonly frames: Frame[] = [];
  readonly terminate = vi.fn();

  send(data: Uint8Array): void {
    this.frames.push(decodeFrame(data));
  }
}

async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe("tunnel origin failures", () => {
  it("logs the failed request without its query string", async () => {
    const port = await closedLoopbackPort();
    const tunnel = new FakeTunnel();
    const warnings: string[] = [];
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: (message) => warnings.push(message) },
      resolveOrigin: () => ({
        kind: "ok",
        resolved: {
          origin: `http://127.0.0.1:${port}`,
          publicOrigin: "https://handle.getbb.app",
        },
      }),
    });
    session.start();

    tunnel.emit(
      "message",
      Buffer.from(
        encodeFrame({
          type: "open-http",
          streamId: 7,
          method: "POST",
          path: "/api/v1/plugins/demo/http/hook?token=secret-token",
          headers: [],
          hasBody: false,
        }),
      ),
      true,
    );

    await vi.waitFor(() => {
      expect(tunnel.frames).toContainEqual(
        expect.objectContaining({ type: "close-stream", streamId: 7 }),
      );
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^origin http error on POST \/api\/v1\/plugins\/demo\/http\/hook: .*ECONNREFUSED/u,
    );
    expect(warnings[0]).not.toContain("secret-token");
    session.dispose();
  });
});
