import type { PrincipalRequest } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { createApp } from "../../src/server.js";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("server principal boundaries", () => {
  it("resolves typed Principal requests at public HTTP and client WebSocket boundaries", async () => {
    const harness = await createTestAppHarness();
    const requests: PrincipalRequest[] = [];
    const rejectingPolicy: PrincipalPolicy = {
      async principal(request) {
        requests.push(request);
        throw new Error("no principal");
      },
      async authorize() {
        return { allowed: false, reason: "unauthenticated" };
      },
    };
    const server = createApp(harness.deps, {
      principalPolicy: rejectingPolicy,
    });

    try {
      expect((await server.app.request("/api/v1/hosts")).status).toBe(401);
      expect((await server.app.request("/ws")).status).toBe(401);
      expect(
        (await server.app.request("/ws/terminals/terminal_1")).status,
      ).toBe(401);

      expect(
        requests.map(({ method, path, transport }) => ({
          method,
          path,
          transport,
        })),
      ).toEqual([
        { method: "GET", path: "/api/v1/hosts", transport: "http" },
        { method: "GET", path: "/ws", transport: "websocket" },
        {
          method: "GET",
          path: "/ws/terminals/terminal_1",
          transport: "websocket",
        },
      ]);

      expect((await server.app.request("/health")).status).toBe(200);
      expect(requests).toHaveLength(3);
    } finally {
      await server.closeWebSockets();
      await harness.cleanup();
    }
  });
});
