import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createLocalOwnerPrincipalPolicy } from "../src/auth/local-owner-adapter.js";
import {
  authorize,
  captureTrustedRemoteAddress,
  createResolvePrincipalMiddleware,
  getTrustedRemoteAddress,
  requirePrincipal,
  TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY,
} from "../src/request-context.js";

describe("request context", () => {
  it("captures the trusted remote address from node connection metadata", async () => {
    const app = new Hono();
    app.use("*", async (context, next) => {
      captureTrustedRemoteAddress(context);
      await next();
    });
    app.get("/", (context) =>
      context.json({
        address: getTrustedRemoteAddress(context),
      }),
    );

    const response = await app.fetch(new Request("http://example.test/"), {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1",
        },
      },
    });

    await expect(response.json()).resolves.toEqual({
      address: "127.0.0.1",
    });
  });

  it("stores undefined when connection metadata is unavailable", async () => {
    const app = new Hono();
    app.get("/", (context) => {
      captureTrustedRemoteAddress(context);
      return context.json({
        hasAddress:
          context.get(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY) !== undefined,
      });
    });

    const response = await app.request("/");

    await expect(response.json()).resolves.toEqual({
      hasAddress: false,
    });
  });
});

describe("request principal context", () => {
  it("requirePrincipal fails closed when no Principal is attached", async () => {
    const app = new Hono();
    app.get("/", (context) => {
      expect(() => requirePrincipal(context)).toThrow(/principal/i);
      return context.json({ ok: true });
    });

    const response = await app.request("/");
    expect(response.status).toBe(200);
  });

  it("authorize denies missing Principal context", async () => {
    const app = new Hono();
    app.get("/", async (context) => {
      const decision = await authorize(
        context,
        { name: "thread.read" },
        { kind: "thread", id: "thr_1" },
      );
      return context.json(decision);
    });

    const response = await app.request("/");
    await expect(response.json()).resolves.toEqual({
      allowed: false,
      reason: "unauthenticated",
    });
  });

  it("authorize uses the attached policy and allows for local-owner", async () => {
    const app = new Hono();
    app.use(
      "*",
      createResolvePrincipalMiddleware(
        createLocalOwnerPrincipalPolicy(),
        "http",
      ),
    );
    app.get("/", async (context) => {
      const decision = await authorize(
        context,
        { name: "thread.read" },
        { kind: "thread", id: "thr_1" },
      );
      return context.json(decision);
    });

    const response = await app.request("/");
    await expect(response.json()).resolves.toEqual({ allowed: true });
  });

  it("returns the same frozen Principal object across nested reads", async () => {
    const app = new Hono();
    app.use(
      "*",
      createResolvePrincipalMiddleware(
        createLocalOwnerPrincipalPolicy(),
        "http",
      ),
    );
    app.get("/", (context) => {
      const outer = requirePrincipal(context);
      const nested = requirePrincipal(context);
      expect(nested).toBe(outer);
      expect(Object.isFrozen(outer)).toBe(true);
      expect(() => {
        (outer as { displayName: string }).displayName = "mutated";
      }).toThrow();
      return context.json({ same: nested === outer, id: outer.id });
    });

    const response = await app.request("/");
    await expect(response.json()).resolves.toEqual({
      same: true,
      id: "local-owner",
    });
  });
});
