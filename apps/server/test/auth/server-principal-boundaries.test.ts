import type { PrincipalRequest } from "@bb/domain";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { createResolvePrincipalMiddleware } from "../../src/request-context.js";
import { createApp } from "../../src/server.js";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("server principal boundaries", () => {
  it("resolves typed Principal requests at public HTTP and client WebSocket boundaries", async () => {
    const harness = await createTestAppHarness();
    const requests: PrincipalRequest[] = [];
    const rejectingPolicy: PrincipalPolicy = {
      async resolve(request) {
        requests.push(request);
        throw new Error("no principal");
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
        requests.map(({ method, target, transport }) => ({
          method,
          target,
          transport,
        })),
      ).toEqual([
        { method: "GET", target: "/api/v1/hosts", transport: "http" },
        { method: "GET", target: "/ws", transport: "websocket" },
        {
          method: "GET",
          target: "/ws/terminals/terminal_1",
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

  it("passes raw path plus query through to PrincipalPolicy as target", async () => {
    const requests: PrincipalRequest[] = [];
    const rejectingPolicy: PrincipalPolicy = {
      async resolve(request) {
        requests.push(request);
        throw new Error("no principal");
      },
    };
    const app = new Hono();
    app.use("*", createResolvePrincipalMiddleware(rejectingPolicy, "http"));
    app.get("/api/v1/hosts", () => new Response(null, { status: 204 }));

    const response = await app.request("/api/v1/hosts?limit=10&offset=0");

    expect(response.status).toBe(401);
    expect(requests).toEqual([
      expect.objectContaining({
        method: "GET",
        target: "/api/v1/hosts?limit=10&offset=0",
        transport: "http",
      }),
    ]);
  });
});
