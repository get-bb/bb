import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME,
  createInternalPrincipalAuthority,
} from "../src/auth/internal-principal-authority.js";
import { createLocalOwnerPrincipalPolicy } from "../src/auth/local-owner-adapter.js";
import type { PrincipalPolicy } from "../src/auth/principal-policy.js";
import {
  authorize,
  captureTrustedRemoteAddress,
  createInternalPrincipalExecutionScopeMiddleware,
  createResolvePrincipalMiddleware,
  getTrustedRemoteAddress,
  requirePrincipal,
  requirePrincipalSession,
  TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY,
} from "../src/request-context.js";
import { createApp } from "../src/server.js";
import { createTestAppHarness } from "./helpers/test-app.js";

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

  it("requirePrincipalSession fails closed when no Principal is attached", async () => {
    const app = new Hono();
    app.get("/", (context) => {
      expect(() => requirePrincipalSession(context)).toThrow(/principal/i);
      return context.json({ ok: true });
    });

    const response = await app.request("/");
    expect(response.status).toBe(200);
  });

  it("requirePrincipalSession returns an immutable attached session", async () => {
    const app = new Hono();
    app.use(
      "*",
      createResolvePrincipalMiddleware(
        createLocalOwnerPrincipalPolicy(),
        "http",
      ),
    );
    app.get("/", async (context) => {
      const session = requirePrincipalSession(context);
      expect(Object.isFrozen(session)).toBe(true);
      expect(Object.isFrozen(session.principal)).toBe(true);
      expect(() => {
        (session as { principal: { id: string } }).principal = {
          id: "attacker",
          kind: "human",
          displayName: "Attacker",
        } as never;
      }).toThrow();
      expect(() => {
        (
          session as unknown as {
            authorize: typeof session.authorize;
          }
        ).authorize = async (_action, _resource) => ({ allowed: true });
      }).toThrow();
      const decision = await session.authorize(
        { name: "thread.read" },
        { kind: "thread", id: "thr_1" },
      );
      return context.json({
        id: session.principal.id,
        decision,
      });
    });

    const response = await app.request("/");
    await expect(response.json()).resolves.toEqual({
      id: "local-owner",
      decision: { allowed: true },
    });
  });
});

describe("internal principal execution scope middleware", () => {
  it("returns unauthorized when Principal attachment is missing", async () => {
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: createLocalOwnerPrincipalPolicy(),
    });
    const app = new Hono();
    app.use("*", createInternalPrincipalExecutionScopeMiddleware(authority));
    app.get("/", (context) => context.json({ ok: true }));

    const response = await app.request("/");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Unauthorized",
    });
  });

  it("makes the active execution scope visible to handlers", async () => {
    const fallback = createLocalOwnerPrincipalPolicy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback,
      loopbackOrigin: "http://127.0.0.1",
      fetch: async () => new Response(null, { status: 204 }),
    });
    const app = new Hono();
    app.use("*", createResolvePrincipalMiddleware(fallback, "http"));
    app.use("*", createInternalPrincipalExecutionScopeMiddleware(authority));
    app.get("/", async (context) => {
      const session = requirePrincipalSession(context);
      const nested = await authority.runWithSession(session, async () => "ok");
      const response = await authority.fetch(
        "http://127.0.0.1/api/v1/projects",
      );
      return context.json({
        nested,
        status: response.status,
        principalId: session.principal.id,
      });
    });

    const response = await app.request("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      nested: "ok",
      status: 204,
      principalId: "local-owner",
    });
  });

  it("rejects different-Principal nesting while the request scope is active", async () => {
    const fallback = createLocalOwnerPrincipalPolicy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback,
    });
    const app = new Hono();
    app.use("*", createResolvePrincipalMiddleware(fallback, "http"));
    app.use("*", createInternalPrincipalExecutionScopeMiddleware(authority));
    app.get("/", async (context) => {
      await expect(
        authority.runWithSession(
          {
            principal: {
              id: "attacker",
              kind: "human",
              displayName: "Attacker",
            },
            authorize: async () => ({ allowed: true }),
          },
          async () => "widened",
        ),
      ).rejects.toThrow(/internal principal authority/i);
      return context.json({
        principalId: requirePrincipal(context).id,
      });
    });

    const response = await app.request("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      principalId: "local-owner",
    });
  });
});

describe("createApp internal principal composition", () => {
  it("keeps local-owner public HTTP behavior without an internal credential", async () => {
    const harness = await createTestAppHarness();
    try {
      const response = await harness.app.request("/api/v1/projects");
      expect(response.status).toBe(200);
    } finally {
      await harness.cleanup();
    }
  });

  it("fails closed on a forged internal credential and never falls back", async () => {
    const harness = await createTestAppHarness();
    const fallbackResolve = vi.fn(async () => {
      throw new Error("fallback must not run for forged internal credentials");
    });
    const policy: PrincipalPolicy = { resolve: fallbackResolve };
    const server = createApp(harness.deps, { principalPolicy: policy });

    try {
      const response = await server.app.request("/api/v1/projects", {
        headers: {
          [INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME]: "a".repeat(64),
        },
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        code: "unauthorized",
        message: "Unauthorized",
      });
      expect(fallbackResolve).not.toHaveBeenCalled();
    } finally {
      await server.closeWebSockets();
      await harness.cleanup();
    }
  });
});
