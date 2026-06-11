import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createIntegrationFetch } from "../../helpers/fetch.js";

interface ResetServer {
  baseUrl: string;
  close(): Promise<void>;
  getAttempts(): number;
}

interface ResetServerOptions {
  resetFirstRequest: boolean;
}

function requireAddress(server: Server): AddressInfo {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected test server to listen on a TCP port");
  }
  return address;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startResetServer(
  options: ResetServerOptions,
): Promise<ResetServer> {
  let attempts = 0;
  let shouldReset = options.resetFirstRequest;
  const server = createServer((request, response) => {
    attempts += 1;
    if (shouldReset) {
      shouldReset = false;
      request.socket.destroy();
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ attempts, ok: true }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = requireAddress(server);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
    getAttempts: () => attempts,
  };
}

describe("createIntegrationFetch", () => {
  it("retries an idempotent GET after a transient socket reset", async () => {
    const server = await startResetServer({ resetFirstRequest: true });
    try {
      const response = await createIntegrationFetch()(server.baseUrl);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ attempts: 2, ok: true });
      expect(server.getAttempts()).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("does not retry a POST after a transient socket reset", async () => {
    const server = await startResetServer({ resetFirstRequest: true });
    try {
      await expect(
        createIntegrationFetch()(server.baseUrl, { method: "POST" }),
      ).rejects.toThrow("fetch failed");
      expect(server.getAttempts()).toBe(1);
    } finally {
      await server.close();
    }
  });
});
