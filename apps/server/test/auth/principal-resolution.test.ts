import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createLocalOwnerPrincipalPolicy } from "../../src/auth/local-owner-adapter.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import {
  createResolvePrincipalMiddleware,
  requirePrincipal,
} from "../../src/request-context.js";

function createRejectingPolicy(): PrincipalPolicy {
  return {
    async principal() {
      throw new Error("rejected");
    },
    async authorize() {
      return { allowed: false, reason: "forbidden" };
    },
  };
}

describe("principal resolution middleware", () => {
  it("attaches the local-owner Principal before the handler runs", async () => {
    const app = new Hono();
    app.use(
      "*",
      createResolvePrincipalMiddleware(
        createLocalOwnerPrincipalPolicy(),
        "http",
      ),
    );
    app.get("/api/v1/projects", (context) => {
      const principal = requirePrincipal(context);
      return context.json({
        id: principal.id,
        kind: principal.kind,
        displayName: principal.displayName,
      });
    });

    const response = await app.request("/api/v1/projects");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "local-owner",
      kind: "human",
      displayName: "Local Owner",
    });
  });

  it("fails closed when the adapter rejects and never reaches the handler", async () => {
    const app = new Hono();
    let handlerReached = false;
    app.use(
      "*",
      createResolvePrincipalMiddleware(createRejectingPolicy(), "http"),
    );
    app.get("/api/v1/projects", (context) => {
      handlerReached = true;
      return context.json({ ok: true });
    });

    const response = await app.request("/api/v1/projects");

    expect(handlerReached).toBe(false);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Unauthorized",
    });
  });

  it("fails closed when the adapter throws and leaves no Principal attached", async () => {
    const app = new Hono();
    let requirePrincipalThrew = false;
    app.use(
      "*",
      createResolvePrincipalMiddleware(createRejectingPolicy(), "http"),
    );
    app.get("/api/v1/projects", (context) => {
      try {
        requirePrincipal(context);
      } catch {
        requirePrincipalThrew = true;
      }
      return context.json({ ok: true });
    });

    const response = await app.request("/api/v1/projects");

    expect(response.status).toBe(401);
    expect(requirePrincipalThrew).toBe(false);
  });

  it("fails closed when an adapter returns an invalid Principal", async () => {
    const app = new Hono();
    let handlerReached = false;
    const invalidPolicy: PrincipalPolicy = {
      async principal() {
        return undefined as never;
      },
      async authorize() {
        return { allowed: true };
      },
    };
    app.use("*", createResolvePrincipalMiddleware(invalidPolicy, "http"));
    app.get("/api/v1/projects", (context) => {
      handlerReached = true;
      return context.json({ id: requirePrincipal(context).id });
    });

    const response = await app.request("/api/v1/projects");

    expect(response.status).toBe(401);
    expect(handlerReached).toBe(false);
  });

  it("fails closed instead of replacing a Principal on duplicate resolution", async () => {
    const app = new Hono();
    let handlerReached = false;
    let duplicatePolicyCalled = false;
    const duplicatePolicy: PrincipalPolicy = {
      async principal() {
        duplicatePolicyCalled = true;
        return {
          id: "replacement",
          kind: "human",
          displayName: "Replacement",
        };
      },
      async authorize() {
        return { allowed: true };
      },
    };
    app.use(
      "*",
      createResolvePrincipalMiddleware(
        createLocalOwnerPrincipalPolicy(),
        "http",
      ),
    );
    app.use("*", createResolvePrincipalMiddleware(duplicatePolicy, "http"));
    app.get("/api/v1/projects", () => {
      handlerReached = true;
      return new Response(null, { status: 204 });
    });

    const response = await app.request("/api/v1/projects");

    expect(response.status).toBe(401);
    expect(handlerReached).toBe(false);
    expect(duplicatePolicyCalled).toBe(false);
  });

  it("resolves a Principal for websocket upgrade paths before the handler", async () => {
    const app = new Hono();
    app.use(
      "/ws",
      createResolvePrincipalMiddleware(
        createLocalOwnerPrincipalPolicy(),
        "websocket",
      ),
    );
    app.get("/ws", (context) => {
      return context.json({ id: requirePrincipal(context).id });
    });
    app.use(
      "/ws/terminals/*",
      createResolvePrincipalMiddleware(
        createLocalOwnerPrincipalPolicy(),
        "websocket",
      ),
    );
    app.get("/ws/terminals/:terminalId", (context) => {
      return context.json({ id: requirePrincipal(context).id });
    });

    await expect((await app.request("/ws")).json()).resolves.toEqual({
      id: "local-owner",
    });
    await expect(
      (await app.request("/ws/terminals/term_1")).json(),
    ).resolves.toEqual({ id: "local-owner" });
  });
});
