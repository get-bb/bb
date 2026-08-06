import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createLocalOwnerPrincipalPolicy } from "../src/auth/local-owner-adapter.js";
import type { PrincipalPolicy } from "../src/auth/principal-policy.js";
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
  it("passes origin-form path plus query as PrincipalRequest.target", async () => {
    const seen: string[] = [];
    const policy: PrincipalPolicy = {
      async resolve(request) {
        seen.push(request.target);
        return {
          principal: {
            id: "target-owner",
            kind: "human",
            displayName: "Target Owner",
          },
          async authorize() {
            return { allowed: true };
          },
        };
      },
    };
    const app = new Hono();
    app.use("*", createResolvePrincipalMiddleware(policy, "http"));
    app.get("/api/v1/hosts", (context) =>
      context.json({ id: requirePrincipal(context).id }),
    );

    const response = await app.request("/api/v1/hosts?limit=5&sort=name");
    expect(response.status).toBe(200);
    expect(seen).toEqual(["/api/v1/hosts?limit=5&sort=name"]);
  });

  it("prefers the Node adapter raw incoming URL for target when present", async () => {
    const seen: string[] = [];
    const policy: PrincipalPolicy = {
      async resolve(request) {
        seen.push(request.target);
        return {
          principal: {
            id: "incoming-owner",
            kind: "human",
            displayName: "Incoming Owner",
          },
          async authorize() {
            return { allowed: true };
          },
        };
      },
    };
    const app = new Hono();
    app.use("*", createResolvePrincipalMiddleware(policy, "http"));
    app.get("/api/v1/hosts", (context) =>
      context.json({ id: requirePrincipal(context).id }),
    );

    const response = await app.fetch(
      new Request("http://example.test/api/v1/hosts?from=fetch"),
      {
        incoming: {
          url: "/api/v1/hosts?from=incoming&raw=1",
        },
      },
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual(["/api/v1/hosts?from=incoming&raw=1"]);
  });

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

  it("authorize uses the closure from that exact resolve and never accepts a Principal argument", async () => {
    const distinctiveDecision = {
      allowed: false as const,
      reason: "forbidden" as const,
    };
    let authorizeCalls = 0;
    type MutableResolvedPrincipal = {
      -readonly [Key in keyof Awaited<
        ReturnType<PrincipalPolicy["resolve"]>
      >]: Awaited<ReturnType<PrincipalPolicy["resolve"]>>[Key];
    };
    let resolvedSession: MutableResolvedPrincipal | undefined;
    const sessionPolicy: PrincipalPolicy = {
      async resolve() {
        resolvedSession = {
          principal: {
            id: "session-owner",
            kind: "human",
            displayName: "Session Owner",
          },
          async authorize(action, resource) {
            authorizeCalls += 1;
            expect(action).toEqual({ name: "thread.read" });
            expect(resource).toEqual({ kind: "thread", id: "thr_1" });
            expect(arguments.length).toBe(2);
            return distinctiveDecision;
          },
        };
        return resolvedSession;
      },
    };
    const app = new Hono();
    app.use("*", createResolvePrincipalMiddleware(sessionPolicy, "http"));
    app.get("/", async (context) => {
      if (resolvedSession === undefined) {
        throw new Error("session was not resolved");
      }
      resolvedSession.authorize = async () => ({ allowed: true });
      expect(authorize.length).toBe(3);
      const decision = await authorize(
        context,
        { name: "thread.read" },
        { kind: "thread", id: "thr_1" },
      );
      return context.json({
        decision,
        principalId: requirePrincipal(context).id,
      });
    });

    const response = await app.request("/");
    await expect(response.json()).resolves.toEqual({
      decision: distinctiveDecision,
      principalId: "session-owner",
    });
    expect(authorizeCalls).toBe(1);
  });

  it("ignores handler attempts to replace identity through Hono context variables", async () => {
    const app = new Hono();
    app.use(
      "*",
      createResolvePrincipalMiddleware(
        createLocalOwnerPrincipalPolicy(),
        "http",
      ),
    );
    app.get("/", async (context) => {
      const unsafeContext = context as unknown as {
        set(key: string, value: unknown): void;
      };
      unsafeContext.set("bbPrincipal", {
        id: "attacker",
        kind: "human",
        displayName: "Attacker",
      });
      unsafeContext.set("bbPrincipalAuthSession", {
        async authorize() {
          return { allowed: false, reason: "forbidden" };
        },
      });

      return context.json({
        principalId: requirePrincipal(context).id,
        decision: await authorize(
          context,
          { name: "thread.read" },
          { kind: "thread", id: "thr_1" },
        ),
      });
    });

    const response = await app.request("/");
    await expect(response.json()).resolves.toEqual({
      principalId: "local-owner",
      decision: { allowed: true },
    });
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
