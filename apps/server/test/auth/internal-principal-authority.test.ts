import { describe, expect, it, vi } from "vitest";
import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
  PrincipalRequest,
} from "@bb/domain";
import {
  INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME,
  InternalPrincipalAuthorityError,
  createInternalPrincipalAuthority as createUnboundInternalPrincipalAuthority,
} from "../../src/auth/internal-principal-authority.js";
import { createInternalExecutionSessions } from "../../src/auth/internal-execution-sessions.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";

const SYSTEM_PRINCIPAL: Principal = Object.freeze({
  id: "system:plugins",
  kind: "system",
  displayName: "Plugins",
});

const LOOPBACK_ORIGIN = "http://127.0.0.1";

function createInternalPrincipalAuthority(
  args: Parameters<typeof createUnboundInternalPrincipalAuthority>[0],
) {
  return createUnboundInternalPrincipalAuthority({
    loopbackOrigin: LOOPBACK_ORIGIN,
    ...args,
  });
}

function createFallbackSpy(): {
  policy: PrincipalPolicy;
  resolve: ReturnType<typeof vi.fn>;
} {
  const resolve = vi.fn(async (_request: PrincipalRequest) => {
    const authorize = async (
      _action: PolicyAction,
      _resource: PolicyResource,
    ): Promise<PolicyDecision> => ({ allowed: true });
    return { principal: SYSTEM_PRINCIPAL, authorize };
  });
  return {
    policy: { resolve },
    resolve,
  };
}

function createSession(principal: Principal = SYSTEM_PRINCIPAL) {
  return {
    principal: { ...principal },
    authorize: vi.fn(
      async (
        _action: PolicyAction,
        _resource: PolicyResource,
      ): Promise<PolicyDecision> => ({ allowed: true }),
    ),
  };
}

type CapturedCall = {
  readonly input: RequestInfo | URL;
  readonly init: RequestInit | undefined;
  readonly credential: string;
  readonly method: string;
};

function createGateFetch(): {
  fetch: typeof fetch;
  waitForCall(): Promise<CapturedCall>;
  release(response?: Response): void;
  fail(error?: Error): void;
} {
  let callResolve!: (call: CapturedCall) => void;
  const callPromise = new Promise<CapturedCall>((resolve) => {
    callResolve = resolve;
  });
  let settle!: {
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  };
  const responsePromise = new Promise<Response>((resolve, reject) => {
    settle = { resolve, reject };
  });

  return {
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      const credential = headers.get(INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME);
      if (credential === null) {
        throw new Error("missing internal credential in test fetch");
      }
      callResolve({
        input,
        init,
        credential,
        method: String(init?.method ?? "GET"),
      });
      return responsePromise;
    },
    waitForCall: () => callPromise,
    release: (response = new Response(null, { status: 204 })) => {
      settle.resolve(response);
    },
    fail: (error = new Error("network failed")) => {
      settle.reject(error);
    },
  };
}

function requestFromCall(
  call: CapturedCall,
  overrides: Partial<{
    method: string;
    target: string;
    transport: "http" | "websocket";
    credential: string | undefined;
    host: string;
  }> = {},
): PrincipalRequest {
  const url =
    typeof call.input === "string"
      ? new URL(call.input)
      : call.input instanceof URL
        ? call.input
        : new URL(String(call.input));
  const credential =
    "credential" in overrides ? overrides.credential : call.credential;
  return {
    method: overrides.method ?? call.method,
    target: overrides.target ?? `${url.pathname}${url.search}`,
    transport: overrides.transport ?? "http",
    getHeader: (name) =>
      name.toLowerCase() === INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME
        ? credential
        : name.toLowerCase() === "host"
          ? (overrides.host ?? url.host)
          : undefined,
  };
}

describe("createInternalPrincipalAuthority", () => {
  it("rejects unbounded grant configuration and invalid clocks", async () => {
    const fallback = createFallbackSpy();

    expect(() =>
      createInternalPrincipalAuthority({
        fallbackPolicy: fallback.policy,
        grantTtlMs: 60_001,
      }),
    ).toThrow(InternalPrincipalAuthorityError);
    expect(() =>
      createInternalPrincipalAuthority({
        fallbackPolicy: fallback.policy,
        maxOutstandingGrants: 10_001,
      }),
    ).toThrow(InternalPrincipalAuthorityError);

    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      now: () => -1,
    });
    await expect(
      authority.runWithSession(createSession(), async () => {
        await authority.fetch("http://127.0.0.1/api/v1/projects");
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
  });

  it("leaves fallback policy unchanged when the internal header is absent", async () => {
    const fallback = createFallbackSpy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });

    const resolved = await authority.principalPolicy.resolve({
      method: "GET",
      target: "/api/v1/projects",
      transport: "http",
      getHeader: () => undefined,
    });

    expect(fallback.resolve).toHaveBeenCalledOnce();
    expect(resolved.principal).toEqual(SYSTEM_PRINCIPAL);
  });

  it("freezes an immutable Principal and bound authorize session", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });
    const mutable: {
      principal: {
        id: string;
        kind: Principal["kind"];
        displayName: string;
      };
      authorize: (
        action: PolicyAction,
        resource: PolicyResource,
      ) => Promise<PolicyDecision>;
    } = createSession();

    const running = authority.runWithSession(mutable, async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects");
    });
    const call = await gate.waitForCall();

    mutable.principal.id = "attacker";
    mutable.authorize = async () => ({
      allowed: false,
      reason: "forbidden",
    });

    const resolved = await authority.principalPolicy.resolve(
      requestFromCall(call),
    );
    expect(resolved.principal).toEqual(SYSTEM_PRINCIPAL);
    expect(Object.isFrozen(resolved.principal)).toBe(true);
    await expect(
      resolved.authorize(
        { name: "publicHttp.projects.list" },
        { kind: "project", id: null },
      ),
    ).resolves.toEqual({ allowed: true });

    gate.release();
    await running;
  });

  it("resolves and authorizes a successful one-use internal grant", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });
    const session = createSession();

    const running = authority.runWithSession(session, async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects?limit=1", {
        method: "get",
      });
    });
    const call = await gate.waitForCall();

    expect(call.credential).toMatch(/^[0-9a-f]{64}$/);
    expect(call.method).toBe("GET");

    const resolved = await authority.principalPolicy.resolve(
      requestFromCall(call),
    );
    expect(fallback.resolve).not.toHaveBeenCalled();
    expect(resolved.principal).toEqual(SYSTEM_PRINCIPAL);
    await expect(
      resolved.authorize(
        { name: "publicHttp.projects.list" },
        { kind: "project", id: null },
      ),
    ).resolves.toEqual({ allowed: true });
    expect(session.authorize).toHaveBeenCalledOnce();

    gate.release();
    await running;
  });

  it("rejects wrong method without falling back", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });

    const running = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects", {
        method: "GET",
      });
    });
    const call = await gate.waitForCall();

    await expect(
      authority.principalPolicy.resolve(
        requestFromCall(call, { method: "POST" }),
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();

    gate.release();
    await running;
  });

  it("rejects wrong target and query without falling back", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });

    const running = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects?limit=1");
    });
    const call = await gate.waitForCall();

    await expect(
      authority.principalPolicy.resolve(
        requestFromCall(call, { target: "/api/v1/projects?limit=2" }),
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    // First mismatch already consumed the grant; a second attempt also fails closed.
    await expect(
      authority.principalPolicy.resolve(
        requestFromCall(call, { target: "/api/v1/threads" }),
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();

    gate.release();
    await running;
  });

  it("rejects wrong transport without falling back", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });

    const running = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects");
    });
    const call = await gate.waitForCall();

    await expect(
      authority.principalPolicy.resolve(
        requestFromCall(call, { transport: "websocket" }),
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();

    gate.release();
    await running;
  });

  it("rejects forged tokens without falling back", async () => {
    const fallback = createFallbackSpy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(
      authority.principalPolicy.resolve({
        method: "GET",
        target: "/api/v1/projects",
        transport: "http",
        getHeader: (name) =>
          name === INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME
            ? "a".repeat(64)
            : undefined,
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();
  });

  it("rejects replay of a consumed grant", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });

    const running = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects");
    });
    const call = await gate.waitForCall();
    const request = requestFromCall(call);

    await expect(
      authority.principalPolicy.resolve(request),
    ).resolves.toMatchObject({ principal: SYSTEM_PRINCIPAL });
    await expect(
      authority.principalPolicy.resolve(request),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();

    gate.release();
    await running;
  });

  it("rejects expired grants via injected time", async () => {
    const fallback = createFallbackSpy();
    let nowMs = 1_000_000;
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
      now: () => nowMs,
      grantTtlMs: 100,
    });

    const running = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects");
    });
    const call = await gate.waitForCall();

    nowMs += 101;
    await expect(
      authority.principalPolicy.resolve(requestFromCall(call)),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();

    gate.release();
    await running;
  });

  it("caps every reserved grant even after policy consumes its token", async () => {
    const fallback = createFallbackSpy();
    let releaseHeld!: (response: Response) => void;
    const heldResponse = new Promise<Response>((resolve) => {
      releaseHeld = resolve;
    });
    let heldCredential: string | undefined;
    let passThroughCalls = 0;

    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      const credential = headers.get(INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME);
      if (credential === null) {
        throw new Error("missing internal credential in test fetch");
      }
      if (heldCredential === undefined) {
        heldCredential = credential;
        return heldResponse;
      }
      passThroughCalls += 1;
      return new Response(null, { status: 204 });
    };

    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: fetchImpl,
      maxOutstandingGrants: 1,
    });

    const first = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/one");
    });
    await vi.waitFor(() => {
      expect(heldCredential).toMatch(/^[0-9a-f]{64}$/);
    });

    await expect(
      authority.principalPolicy.resolve({
        method: "GET",
        target: "/api/v1/one",
        transport: "http",
        getHeader: (name) =>
          name === INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME
            ? heldCredential
            : name === "host"
              ? "127.0.0.1"
              : undefined,
      }),
    ).resolves.toMatchObject({ principal: SYSTEM_PRINCIPAL });

    await expect(
      authority.runWithSession(createSession(), async () => {
        await authority.fetch("http://127.0.0.1/api/v1/two");
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);

    releaseHeld(new Response(null, { status: 204 }));
    await first;

    await expect(
      authority.runWithSession(createSession(), async () => {
        await authority.fetch("http://127.0.0.1/api/v1/three");
      }),
    ).resolves.toBeUndefined();
    expect(passThroughCalls).toBe(1);
  });

  it("fails fetch outside a scope before calling the network", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });

    await expect(
      authority.fetch("http://127.0.0.1/api/v1/projects"),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(underlying).not.toHaveBeenCalled();
  });

  it("rejects off-origin and wrong-port destinations before minting or network", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });

    await expect(
      authority.runWithSession(createSession(), async () => {
        await authority.fetch("https://evil.example/api/v1/projects");
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    await expect(
      authority.runWithSession(createSession(), async () => {
        await authority.fetch("http://127.0.0.1:38887/api/v1/projects");
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(underlying).not.toHaveBeenCalled();
  });

  it("forces redirect errors and rejects a mismatched Host at policy", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });

    const running = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects", {
        redirect: "follow",
      });
    });
    const call = await gate.waitForCall();
    expect(call.init?.redirect).toBe("error");
    await expect(
      authority.principalPolicy.resolve(
        requestFromCall(call, { host: "127.0.0.1:38887" }),
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();

    gate.release();
    await running;
  });

  it("accepts exactly one loopback-origin binding", () => {
    const fallback = createFallbackSpy();
    const authority = createUnboundInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
    });

    authority.bindLoopbackOrigin("http://127.0.0.1:38886");
    expect(() =>
      authority.bindLoopbackOrigin("http://127.0.0.1:38886"),
    ).toThrow(InternalPrincipalAuthorityError);
    expect(() =>
      createUnboundInternalPrincipalAuthority({
        fallbackPolicy: fallback.policy,
        loopbackOrigin: "https://127.0.0.1:38886",
      }),
    ).toThrow(InternalPrincipalAuthorityError);
    expect(() =>
      createUnboundInternalPrincipalAuthority({
        fallbackPolicy: fallback.policy,
        loopbackOrigin: "http://localhost:38886",
      }),
    ).toThrow(InternalPrincipalAuthorityError);
  });

  it("rejects a caller-prepopulated internal credential header before network", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });

    await expect(
      authority.runWithSession(createSession(), async () => {
        await authority.fetch("http://127.0.0.1/api/v1/projects", {
          headers: {
            [INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME]: "caller-token",
          },
        });
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(underlying).not.toHaveBeenCalled();
  });

  it("allows same-Principal reentrancy and ignores a replacement authorizer", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });
    const outerAuthorize = vi.fn(
      async (): Promise<PolicyDecision> => ({ allowed: true }),
    );
    const innerAuthorize = vi.fn(
      async (): Promise<PolicyDecision> => ({
        allowed: false,
        reason: "forbidden",
      }),
    );

    await authority.runWithSession(
      {
        principal: { ...SYSTEM_PRINCIPAL },
        authorize: outerAuthorize,
      },
      async () => {
        await authority.runWithSession(
          {
            principal: { ...SYSTEM_PRINCIPAL },
            authorize: innerAuthorize,
          },
          async () => {
            await authority.fetch("http://127.0.0.1/api/v1/projects");
          },
        );
      },
    );

    expect(underlying).toHaveBeenCalledOnce();
    expect(innerAuthorize).not.toHaveBeenCalled();
    expect(outerAuthorize).not.toHaveBeenCalled();
  });

  it("same-Principal reentrancy cannot widen authority via nested authorize", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });
    const outerAuthorize = vi.fn(
      async (): Promise<PolicyDecision> => ({
        allowed: false,
        reason: "forbidden",
      }),
    );
    const wideningAuthorize = vi.fn(
      async (): Promise<PolicyDecision> => ({ allowed: true }),
    );

    const running = authority.runWithSession(
      {
        principal: { ...SYSTEM_PRINCIPAL },
        authorize: outerAuthorize,
      },
      async () => {
        await authority.runWithSession(
          {
            principal: { ...SYSTEM_PRINCIPAL },
            authorize: wideningAuthorize,
          },
          async () => {
            await authority.fetch("http://127.0.0.1/api/v1/projects");
          },
        );
      },
    );
    const call = await gate.waitForCall();
    const resolved = await authority.principalPolicy.resolve(
      requestFromCall(call),
    );
    await expect(
      resolved.authorize(
        { name: "publicHttp.projects.list" },
        { kind: "project", id: null },
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    expect(wideningAuthorize).not.toHaveBeenCalled();
    expect(outerAuthorize).toHaveBeenCalledOnce();

    gate.release();
    await running;
  });

  it("rejects nested scope replacement for a different Principal", async () => {
    const fallback = createFallbackSpy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });
    const otherPrincipal: Principal = Object.freeze({
      id: "system:other",
      kind: "system",
      displayName: "Other",
    });

    await expect(
      authority.runWithSession(createSession(), async () => {
        await authority.runWithSession(
          createSession(otherPrincipal),
          async () => "nested",
        );
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
  });

  it("fails leaked timer and async descendants after callback settlement", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });

    let leakedFetch!: Promise<Response>;
    await authority.runWithSession(createSession(), () => {
      leakedFetch = new Promise((resolve, reject) => {
        setTimeout(() => {
          void authority
            .fetch("http://127.0.0.1/api/v1/projects")
            .then(resolve, reject);
        }, 0);
      });
      return "done";
    });

    await expect(leakedFetch).rejects.toBeInstanceOf(
      InternalPrincipalAuthorityError,
    );
    expect(underlying).not.toHaveBeenCalled();
  });

  it("rejects a grant that reaches policy after its callback scope settles", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });

    let detachedFetch!: Promise<Response>;
    await authority.runWithSession(createSession(), async () => {
      detachedFetch = authority.fetch(
        "http://127.0.0.1/api/v1/projects?late=1",
      );
      await gate.waitForCall();
      // Deliberately return without awaiting the SDK request.
    });
    const call = await gate.waitForCall();

    await expect(
      authority.principalPolicy.resolve(requestFromCall(call)),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();

    gate.release();
    await detachedFetch;
  });

  it("does not reuse an expired token while its original fetch is in flight", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    let nowMs = 1_000;
    const deterministicBytes = new Uint8Array(32).fill(7);
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
      now: () => nowMs,
      grantTtlMs: 10,
      randomBytes: () => deterministicBytes,
    });

    const first = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/first");
    });
    await gate.waitForCall();
    nowMs += 11;

    await expect(
      authority.runWithSession(createSession(), async () => {
        await authority.fetch("http://127.0.0.1/api/v1/second");
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);

    gate.release();
    await first;
  });

  it("rejects scope replacement from an inactive async descendant", async () => {
    const fallback = createFallbackSpy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });

    let descendant!: Promise<string>;
    await authority.runWithSession(createSession(), () => {
      descendant = new Promise((resolve, reject) => {
        setTimeout(() => {
          void authority
            .runWithSession(createSession(), async () => "replaced")
            .then(resolve, reject);
        }, 0);
      });
    });

    await expect(descendant).rejects.toBeInstanceOf(
      InternalPrincipalAuthorityError,
    );
  });

  it("removes an unconsumed grant after underlying fetch failure", async () => {
    const fallback = createFallbackSpy();
    const gate = createGateFetch();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: gate.fetch,
    });

    const running = authority.runWithSession(createSession(), async () => {
      await authority.fetch("http://127.0.0.1/api/v1/projects");
    });
    const call = await gate.waitForCall();
    gate.fail(new Error("network failed"));
    await expect(running).rejects.toThrow(/network failed/);

    await expect(
      authority.principalPolicy.resolve(requestFromCall(call)),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(fallback.resolve).not.toHaveBeenCalled();
  });

  it("keeps error messages credential-free", async () => {
    const fallback = createFallbackSpy();
    const token = "f".repeat(64);
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(
      authority.principalPolicy.resolve({
        method: "GET",
        target: "/api/v1/projects",
        transport: "http",
        getHeader: () => token,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(InternalPrincipalAuthorityError);
      expect(String(error)).not.toContain(token);
      return true;
    });
  });
});

describe("InternalPrincipalAuthority derived sessions", () => {
  const issuedSessions = createInternalExecutionSessions({
    mode: "local-owner",
  });
  const createSystemDerivedSession = () =>
    issuedSessions.createPluginBackgroundSession({
      pluginId: "workflows",
      callbackCategory: "service",
      callbackName: "worker",
    });
  const createAgentDerivedSession = () =>
    issuedSessions.createThreadAgentSession({
      threadId: "thread_1",
      projectId: "project_1",
    });
  const AGENT_PRINCIPAL: Principal = Object.freeze({
    id: "agent:thread/thread_1",
    kind: "agent",
    displayName: "Thread agent",
  });

  const HUMAN_PRINCIPAL: Principal = Object.freeze({
    id: "local-owner",
    kind: "human",
    displayName: "Local Owner",
  });

  const MACHINE_PRINCIPAL: Principal = Object.freeze({
    id: "host_1",
    kind: "machine",
    displayName: "Host daemon",
  });

  it("replaces an active request scope and restores it afterward", async () => {
    const fallback = createFallbackSpy();
    const seenKinds: string[] = [];
    let authority!: ReturnType<typeof createInternalPrincipalAuthority>;
    authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        const credential = headers.get(
          INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME,
        );
        if (credential === null) {
          throw new Error("missing internal credential in test fetch");
        }
        const url =
          typeof input === "string"
            ? new URL(input)
            : input instanceof URL
              ? input
              : new URL(String((input as Request).url));
        const resolved = await authority.principalPolicy.resolve({
          method: "GET",
          target: `${url.pathname}${url.search}`,
          transport: "http",
          getHeader: (name) =>
            name.toLowerCase() === INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME
              ? credential
              : name.toLowerCase() === "host"
                ? url.host
                : undefined,
        });
        seenKinds.push(resolved.principal.kind);
        return new Response(null, { status: 204 });
      },
    });
    const requestSession = createSession(HUMAN_PRINCIPAL);
    const derivedSession = createSystemDerivedSession();

    await authority.runWithSession(requestSession, async () => {
      await authority.fetch("http://127.0.0.1/api/v1/outer");
      await authority.runWithDerivedSession(derivedSession, async () => {
        await authority.fetch("http://127.0.0.1/api/v1/derived");
      });
      await authority.fetch("http://127.0.0.1/api/v1/restored");
    });

    expect(seenKinds).toEqual(["human", "system", "human"]);
  });

  it("replaces an inactive inherited request scope", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });

    let afterSettle!: Promise<string>;
    await authority.runWithSession(createSession(HUMAN_PRINCIPAL), () => {
      afterSettle = new Promise((resolve, reject) => {
        setTimeout(() => {
          void authority
            .runWithDerivedSession(createSystemDerivedSession(), async () => {
              await authority.fetch("http://127.0.0.1/api/v1/projects");
              return "derived-ok";
            })
            .then(resolve, reject);
        }, 0);
      });
    });

    await expect(afterSettle).resolves.toBe("derived-ok");
    expect(underlying).toHaveBeenCalledOnce();
  });

  it("deactivates async derived scopes so leaked descendants cannot fetch", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });

    let leakedFetch!: Promise<Response>;
    await authority.runWithDerivedSession(createSystemDerivedSession(), () => {
      leakedFetch = new Promise((resolve, reject) => {
        setTimeout(() => {
          void authority
            .fetch("http://127.0.0.1/api/v1/projects")
            .then(resolve, reject);
        }, 0);
      });
      return "done";
    });

    await expect(leakedFetch).rejects.toBeInstanceOf(
      InternalPrincipalAuthorityError,
    );
    expect(underlying).not.toHaveBeenCalled();
  });

  it("deactivates sync derived scopes so leaked descendants cannot replace", async () => {
    const fallback = createFallbackSpy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });

    let leaked!: Promise<string>;
    authority.runWithDerivedSessionSync(createAgentDerivedSession(), () => {
      leaked = new Promise((resolve, reject) => {
        setTimeout(() => {
          void authority
            .runWithDerivedSession(
              createSystemDerivedSession(),
              async () => "nested",
            )
            .then(resolve, reject);
        }, 0);
      });
      return "sync-done";
    });

    await expect(leaked).rejects.toBeInstanceOf(
      InternalPrincipalAuthorityError,
    );
  });

  it("deactivates sync derived scopes so leaked descendants cannot fetch", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });

    let leakedFetch!: Promise<Response>;
    authority.runWithDerivedSessionSync(createSystemDerivedSession(), () => {
      leakedFetch = new Promise((resolve, reject) => {
        setTimeout(() => {
          void authority
            .fetch("http://127.0.0.1/api/v1/projects")
            .then(resolve, reject);
        }, 0);
      });
      return "done";
    });

    await expect(leakedFetch).rejects.toBeInstanceOf(
      InternalPrincipalAuthorityError,
    );
    expect(underlying).not.toHaveBeenCalled();
  });

  it("rejects every unissued structural Principal for derived scopes", async () => {
    const fallback = createFallbackSpy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(
      authority.runWithDerivedSession(
        createSession(HUMAN_PRINCIPAL),
        async () => "nope",
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    await expect(
      authority.runWithDerivedSession(
        createSession(MACHINE_PRINCIPAL),
        async () => "nope",
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    await expect(
      authority.runWithDerivedSession(
        createSession(SYSTEM_PRINCIPAL),
        async () => "nope",
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    await expect(
      authority.runWithDerivedSession(
        createSession(AGENT_PRINCIPAL),
        async () => "nope",
      ),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
    expect(() =>
      authority.runWithDerivedSessionSync(
        createSession(HUMAN_PRINCIPAL),
        () => "nope",
      ),
    ).toThrow(InternalPrincipalAuthorityError);
    expect(() =>
      authority.runWithDerivedSessionSync(
        createSession(MACHINE_PRINCIPAL),
        () => "nope",
      ),
    ).toThrow(InternalPrincipalAuthorityError);
  });

  it("installs a derived scope with no inherited request scope", async () => {
    const fallback = createFallbackSpy();
    const underlying = vi.fn(async () => new Response(null, { status: 204 }));
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: underlying,
    });

    await expect(
      authority.runWithDerivedSession(
        createSystemDerivedSession(),
        async () => {
          await authority.fetch("http://127.0.0.1/api/v1/projects");
          return "fresh";
        },
      ),
    ).resolves.toBe("fresh");
    expect(
      authority.runWithDerivedSessionSync(
        createAgentDerivedSession(),
        () => "sync-fresh",
      ),
    ).toBe("sync-fresh");
    expect(underlying).toHaveBeenCalledOnce();
  });

  it("rejects thenable returns from the sync derived API", () => {
    const fallback = createFallbackSpy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });

    expect(() =>
      authority.runWithDerivedSessionSync(createSystemDerivedSession(), () =>
        Promise.resolve("async"),
      ),
    ).toThrow(InternalPrincipalAuthorityError);
    expect(() =>
      authority.runWithDerivedSessionSync(
        createSystemDerivedSession(),
        () =>
          ({
            then(resolve: (value: string) => void) {
              resolve("thenable");
            },
          }) as unknown as string,
      ),
    ).toThrow(InternalPrincipalAuthorityError);
  });

  it("keeps runWithSession rejection of inactive and different replacements", async () => {
    const fallback = createFallbackSpy();
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: fallback.policy,
      fetch: async () => new Response(null, { status: 204 }),
    });

    let inactiveReplacement!: Promise<string>;
    await authority.runWithSession(createSession(HUMAN_PRINCIPAL), () => {
      inactiveReplacement = new Promise((resolve, reject) => {
        setTimeout(() => {
          void authority
            .runWithSession(
              createSession(HUMAN_PRINCIPAL),
              async () => "replaced",
            )
            .then(resolve, reject);
        }, 0);
      });
    });
    await expect(inactiveReplacement).rejects.toBeInstanceOf(
      InternalPrincipalAuthorityError,
    );

    await expect(
      authority.runWithSession(createSession(HUMAN_PRINCIPAL), async () => {
        await authority.runWithSession(
          createSession(SYSTEM_PRINCIPAL),
          async () => "nested",
        );
      }),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
  });
});
