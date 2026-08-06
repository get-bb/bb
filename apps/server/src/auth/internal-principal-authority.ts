import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
  PrincipalKind,
  PrincipalRequest,
} from "@bb/domain";
import type { PrincipalPolicy, ResolvedPrincipal } from "./principal-policy.js";
import { isIssuedInternalDerivedSession } from "./internal-execution-sessions.js";

/** Fixed header carrying an opaque one-use internal Principal grant. */
export const INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME =
  "x-bb-internal-principal-credential";

const DEFAULT_GRANT_TTL_MS = 10_000;
const DEFAULT_MAX_OUTSTANDING_GRANTS = 128;
const MAX_GRANT_TTL_MS = 60_000;
const MAX_OUTSTANDING_GRANTS = 10_000;
const GRANT_TOKEN_BYTE_LENGTH = 32;
const PRINCIPAL_KINDS = new Set<PrincipalKind>([
  "human",
  "agent",
  "machine",
  "system",
]);

type FetchImplementation = typeof fetch;
type RandomBytes = (size: number) => Uint8Array;

export type InternalPrincipalSession = {
  readonly principal: Principal;
  authorize(
    action: PolicyAction,
    resource: PolicyResource,
  ): Promise<PolicyDecision>;
};

export type CreateInternalPrincipalAuthorityArgs = {
  readonly fallbackPolicy: PrincipalPolicy;
  readonly fetch?: FetchImplementation;
  readonly randomBytes?: RandomBytes;
  readonly now?: () => number;
  readonly grantTtlMs?: number;
  readonly maxOutstandingGrants?: number;
  /** Optional one-time initial binding; otherwise bind before the first fetch. */
  readonly loopbackOrigin?: string;
};

export type InternalPrincipalAuthority = {
  readonly principalPolicy: PrincipalPolicy;
  bindLoopbackOrigin(origin: string): void;
  runWithSession<T>(
    session: InternalPrincipalSession,
    fn: () => T | Promise<T>,
  ): Promise<T>;
  /**
   * Run a callback behind an explicit authority-suppression fence. This is
   * used for plugin factory evaluation, which must never inherit a request or
   * derived Principal from the lifecycle operation that triggered the load.
   */
  runWithoutSession<T>(fn: () => T | Promise<T>): Promise<T>;
  /**
   * Temporarily replace an active or inactive inherited scope with a
   * system/agent session. Restores the outer ALS scope when `fn` settles.
   */
  runWithDerivedSession<T>(
    session: InternalPrincipalSession,
    fn: () => T | Promise<T>,
  ): Promise<T>;
  /**
   * Sync derived-scope entry. Rejects thenable returns so the scope cannot
   * deactivate while async work continues.
   */
  runWithDerivedSessionSync<T>(
    session: InternalPrincipalSession,
    fn: () => T,
  ): T;
  readonly fetch: FetchImplementation;
};

type BoundSession = {
  readonly principal: Principal;
  readonly authorize: (
    action: PolicyAction,
    resource: PolicyResource,
  ) => Promise<PolicyDecision>;
};

type ExecutionScope = {
  readonly session: BoundSession;
  active: boolean;
  /** True when installed by a derived transition, not a request session. */
  readonly derived: boolean;
};

const SUPPRESSED_SESSION: BoundSession = Object.freeze({
  principal: Object.freeze({
    id: "system:internal-authority-suppressed",
    kind: "system",
    displayName: "Suppressed internal authority",
  }),
  authorize: Object.freeze(
    async (): Promise<PolicyDecision> => ({
      allowed: false,
      reason: "forbidden",
    }),
  ),
});

type OutstandingGrant = {
  readonly host: string;
  readonly method: string;
  readonly target: string;
  readonly transport: "http";
  readonly session: BoundSession;
  /** Shared lifetime fence; the request must resolve before its callback settles. */
  readonly scope: ExecutionScope;
  readonly expiresAtMs: number;
};

/**
 * Sanitized internal Principal authority failure. Messages must stay generic
 * and must never echo tokens, targets, principals, or grant details.
 */
export class InternalPrincipalAuthorityError extends Error {
  constructor() {
    super("Internal principal authority rejected the request");
    this.name = "InternalPrincipalAuthorityError";
  }
}

function rejectInternalPrincipalAuthority(): never {
  throw new InternalPrincipalAuthorityError();
}

function readPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    !Number.isSafeInteger(value) ||
    value > maximum
  ) {
    rejectInternalPrincipalAuthority();
  }
  return value;
}

function freezePrincipal(principal: Principal): Principal {
  if (
    principal === null ||
    typeof principal !== "object" ||
    typeof principal.id !== "string" ||
    principal.id.trim().length === 0 ||
    typeof principal.displayName !== "string" ||
    principal.displayName.trim().length === 0 ||
    !PRINCIPAL_KINDS.has(principal.kind)
  ) {
    rejectInternalPrincipalAuthority();
  }
  return Object.freeze({
    id: principal.id,
    kind: principal.kind,
    displayName: principal.displayName,
  });
}

function assertValidAction(action: PolicyAction): void {
  if (
    action === null ||
    typeof action !== "object" ||
    typeof action.name !== "string" ||
    action.name.trim().length === 0
  ) {
    rejectInternalPrincipalAuthority();
  }
}

function assertValidResource(resource: PolicyResource): void {
  if (
    resource === null ||
    typeof resource !== "object" ||
    typeof resource.kind !== "string" ||
    resource.kind.trim().length === 0 ||
    !(typeof resource.id === "string" || resource.id === null)
  ) {
    rejectInternalPrincipalAuthority();
  }
}

function samePrincipal(left: Principal, right: Principal): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.displayName === right.displayName
  );
}

function assertDerivedPrincipalKind(principal: Principal): void {
  if (principal.kind !== "system" && principal.kind !== "agent") {
    rejectInternalPrincipalAuthority();
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function bindSession(session: InternalPrincipalSession): BoundSession {
  if (
    session === null ||
    typeof session !== "object" ||
    typeof session.authorize !== "function"
  ) {
    rejectInternalPrincipalAuthority();
  }
  const principal = freezePrincipal(session.principal);
  const authorizeImpl = session.authorize.bind(session);
  const authorize = Object.freeze(
    async (
      action: PolicyAction,
      resource: PolicyResource,
    ): Promise<PolicyDecision> => {
      assertValidAction(action);
      assertValidResource(resource);
      return authorizeImpl(action, resource);
    },
  );
  return Object.freeze({ principal, authorize });
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function mintOpaqueToken(randomBytes: RandomBytes): string {
  const bytes = randomBytes(GRANT_TOKEN_BYTE_LENGTH);
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < GRANT_TOKEN_BYTE_LENGTH
  ) {
    rejectInternalPrincipalAuthority();
  }
  return bytesToHex(bytes.subarray(0, GRANT_TOKEN_BYTE_LENGTH));
}

function readHeaderValue(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  return value === null ? undefined : value;
}

function resolveRequestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return new URL(input.href);
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  if (input instanceof Request) {
    return new URL(input.url);
  }
  rejectInternalPrincipalAuthority();
}

function resolveRequestMethod(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): string {
  if (typeof init?.method === "string" && init.method.length > 0) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function resolveOriginFormTarget(url: URL): string {
  return `${url.pathname}${url.search}`;
}

function parseLoopbackOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    rejectInternalPrincipalAuthority();
  }
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    rejectInternalPrincipalAuthority();
  }
  return url;
}

function collectOutboundHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Headers {
  if (init?.headers !== undefined) {
    return new Headers(init.headers);
  }
  if (input instanceof Request) {
    return new Headers(input.headers);
  }
  return new Headers();
}

/**
 * Deep in-process Principal authority kernel for loopback SDK calls.
 *
 * Composes one-use method/target-bound grants with a fallback PrincipalPolicy.
 * Execution authority lives only in AsyncLocalStorage for the duration of
 * `runWithSession`; grant maps and minting stay module-private.
 */
export function createInternalPrincipalAuthority(
  args: CreateInternalPrincipalAuthorityArgs,
): InternalPrincipalAuthority {
  if (
    args === null ||
    typeof args !== "object" ||
    args.fallbackPolicy === null ||
    typeof args.fallbackPolicy !== "object" ||
    typeof args.fallbackPolicy.resolve !== "function"
  ) {
    rejectInternalPrincipalAuthority();
  }

  const fallbackResolve = args.fallbackPolicy.resolve.bind(args.fallbackPolicy);
  const underlyingFetch = args.fetch ?? fetch;
  const randomBytes = args.randomBytes ?? nodeRandomBytes;
  const now = args.now ?? Date.now;
  const grantTtlMs = readPositiveInteger(
    args.grantTtlMs,
    DEFAULT_GRANT_TTL_MS,
    MAX_GRANT_TTL_MS,
  );
  const maxOutstandingGrants = readPositiveInteger(
    args.maxOutstandingGrants,
    DEFAULT_MAX_OUTSTANDING_GRANTS,
    MAX_OUTSTANDING_GRANTS,
  );

  const executionScopes = new AsyncLocalStorage<ExecutionScope>();
  const outstandingGrants = new Map<string, OutstandingGrant>();
  // A consumed/expired grant may still belong to an in-flight fetch. Keep its
  // token reserved until that fetch settles so cleanup can never delete a
  // newer grant after a (pathological or injected) random collision.
  const reservedTokens = new Set<string>();
  let loopbackOrigin: URL | null =
    args.loopbackOrigin === undefined
      ? null
      : parseLoopbackOrigin(args.loopbackOrigin);

  function bindLoopbackOrigin(origin: string): void {
    if (loopbackOrigin !== null) {
      rejectInternalPrincipalAuthority();
    }
    loopbackOrigin = parseLoopbackOrigin(origin);
  }

  function readSafeNowMs(): number {
    const value = now();
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      rejectInternalPrincipalAuthority();
    }
    return value;
  }

  function cleanExpiredGrants(nowMs: number): void {
    for (const [token, grant] of outstandingGrants) {
      if (grant.expiresAtMs <= nowMs) {
        outstandingGrants.delete(token);
      }
    }
  }

  function mintGrant(args: {
    readonly host: string;
    readonly method: string;
    readonly target: string;
    readonly session: BoundSession;
    readonly scope: ExecutionScope;
  }): string {
    const nowMs = readSafeNowMs();
    cleanExpiredGrants(nowMs);
    if (reservedTokens.size >= maxOutstandingGrants) {
      rejectInternalPrincipalAuthority();
    }
    const token = mintOpaqueToken(randomBytes);
    if (reservedTokens.has(token)) {
      rejectInternalPrincipalAuthority();
    }
    reservedTokens.add(token);
    const expiresAtMs = nowMs + grantTtlMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      reservedTokens.delete(token);
      rejectInternalPrincipalAuthority();
    }
    outstandingGrants.set(
      token,
      Object.freeze({
        host: args.host,
        method: args.method,
        target: args.target,
        transport: "http",
        session: args.session,
        scope: args.scope,
        expiresAtMs,
      }),
    );
    return token;
  }

  async function runWithSession<T>(
    session: InternalPrincipalSession,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    if (typeof fn !== "function") {
      rejectInternalPrincipalAuthority();
    }

    const current = executionScopes.getStore();
    if (current !== undefined) {
      // An async descendant retains the ALS store after the parent settles.
      // Inactive inherited scopes may never mint a replacement authority.
      if (!current.active) {
        rejectInternalPrincipalAuthority();
      }
      if (session === null || typeof session !== "object") {
        rejectInternalPrincipalAuthority();
      }
      // Same already-active Principal may reenter the current scope, but any
      // replacement authorizer is ignored so nested calls cannot widen authority.
      const nestedPrincipal = freezePrincipal(session.principal);
      if (!samePrincipal(nestedPrincipal, current.session.principal)) {
        rejectInternalPrincipalAuthority();
      }
      return await fn();
    }

    const bound = bindSession(session);
    const scope: ExecutionScope = {
      session: bound,
      active: true,
      derived: false,
    };

    return executionScopes.run(scope, async () => {
      try {
        return await fn();
      } finally {
        scope.active = false;
      }
    });
  }

  async function runWithoutSession<T>(fn: () => T | Promise<T>): Promise<T> {
    if (typeof fn !== "function") {
      rejectInternalPrincipalAuthority();
    }
    const scope: ExecutionScope = {
      session: SUPPRESSED_SESSION,
      active: false,
      // Treat suppressed descendants like settled derived work: they may not
      // re-elevate themselves by entering another derived session.
      derived: true,
    };
    return executionScopes.run(scope, async () => await fn());
  }

  function assertDerivedReplacementAllowed(
    current: ExecutionScope | undefined,
  ): void {
    if (current === undefined) {
      return;
    }
    // Active scopes may be temporarily replaced. Inactive request leftovers may
    // also be replaced for background/plugin transitions. Inactive derived
    // leftovers must not — that would let leaked descendants re-elevate.
    if (current.active) {
      return;
    }
    if (!current.derived) {
      return;
    }
    rejectInternalPrincipalAuthority();
  }

  async function runWithDerivedSession<T>(
    session: InternalPrincipalSession,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    if (typeof fn !== "function") {
      rejectInternalPrincipalAuthority();
    }
    if (!isIssuedInternalDerivedSession(session)) {
      rejectInternalPrincipalAuthority();
    }
    assertDerivedReplacementAllowed(executionScopes.getStore());
    const bound = bindSession(session);
    assertDerivedPrincipalKind(bound.principal);
    const scope: ExecutionScope = {
      session: bound,
      active: true,
      derived: true,
    };
    // Derived scopes intentionally replace any inherited active or inactive
    // request scope. ALS restores the outer store when this run settles.
    return executionScopes.run(scope, async () => {
      try {
        return await fn();
      } finally {
        scope.active = false;
      }
    });
  }

  function runWithDerivedSessionSync<T>(
    session: InternalPrincipalSession,
    fn: () => T,
  ): T {
    if (typeof fn !== "function") {
      rejectInternalPrincipalAuthority();
    }
    if (!isIssuedInternalDerivedSession(session)) {
      rejectInternalPrincipalAuthority();
    }
    assertDerivedReplacementAllowed(executionScopes.getStore());
    const bound = bindSession(session);
    assertDerivedPrincipalKind(bound.principal);
    const scope: ExecutionScope = {
      session: bound,
      active: true,
      derived: true,
    };
    return executionScopes.run(scope, () => {
      try {
        const result = fn();
        if (isThenable(result)) {
          rejectInternalPrincipalAuthority();
        }
        return result;
      } finally {
        scope.active = false;
      }
    });
  }

  const internalFetch: FetchImplementation = async (input, init) => {
    const scope = executionScopes.getStore();
    if (scope === undefined || !scope.active) {
      rejectInternalPrincipalAuthority();
    }

    const expectedOrigin = loopbackOrigin;
    if (expectedOrigin === null) {
      rejectInternalPrincipalAuthority();
    }
    const url = resolveRequestUrl(input);
    if (url.origin !== expectedOrigin.origin) {
      rejectInternalPrincipalAuthority();
    }

    const headers = collectOutboundHeaders(input, init);
    if (
      readHeaderValue(headers, INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME) !==
      undefined
    ) {
      rejectInternalPrincipalAuthority();
    }

    const method = resolveRequestMethod(input, init);
    const target = resolveOriginFormTarget(url);
    const token = mintGrant({
      host: url.host,
      method,
      target,
      session: scope.session,
      scope,
    });
    headers.set(INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME, token);

    try {
      return await underlyingFetch(input, {
        ...init,
        method,
        headers,
        redirect: "error",
      });
    } finally {
      outstandingGrants.delete(token);
      reservedTokens.delete(token);
    }
  };

  const principalPolicy: PrincipalPolicy = {
    async resolve(request: PrincipalRequest): Promise<ResolvedPrincipal> {
      const credential = request.getHeader(
        INTERNAL_PRINCIPAL_CREDENTIAL_HEADER_NAME,
      );
      if (credential === undefined) {
        return fallbackResolve(request);
      }

      // Header present: consume before validation and never fall back.
      const grant = outstandingGrants.get(credential);
      outstandingGrants.delete(credential);
      if (grant === undefined) {
        rejectInternalPrincipalAuthority();
      }

      const nowMs = readSafeNowMs();
      if (grant.expiresAtMs <= nowMs) {
        rejectInternalPrincipalAuthority();
      }
      if (!grant.scope.active) {
        rejectInternalPrincipalAuthority();
      }
      if (request.method.toUpperCase() !== grant.method) {
        rejectInternalPrincipalAuthority();
      }
      if (request.getHeader("host") !== grant.host) {
        rejectInternalPrincipalAuthority();
      }
      if (request.target !== grant.target) {
        rejectInternalPrincipalAuthority();
      }
      if (request.transport !== grant.transport) {
        rejectInternalPrincipalAuthority();
      }

      return Object.freeze({
        principal: grant.session.principal,
        authorize: grant.session.authorize,
      });
    },
  };

  return Object.freeze({
    bindLoopbackOrigin,
    principalPolicy,
    runWithSession,
    runWithoutSession,
    runWithDerivedSession,
    runWithDerivedSessionSync,
    fetch: internalFetch,
  });
}
