import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  ensurePersonalProject,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import {
  publicApiRoutes,
  WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER,
  WORK_TOGETHER_PRINCIPAL_JWT_ALG,
  WORK_TOGETHER_PRINCIPAL_JWT_TYP,
} from "@bb/server-contract";
import { Hono } from "hono";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  PUBLIC_HTTP_ACTION_PREFIX,
  PUBLIC_HTTP_INVENTORY,
  PUBLIC_HTTP_MEMBER_OPERATION_NAMES,
  PUBLIC_HTTP_UNMAPPED_ACTION_NAME,
  PUBLIC_HTTP_WORK_TOGETHER_OWNER_OPERATION_NAMES,
  UNTYPED_PUBLIC_HTTP_INVENTORY,
  createPublicHttpAuthorizationMiddleware,
  isMemberAllowedPublicHttpAuthorization,
  isRegistryIssuedPublicHttpAuthorization,
  resolvePublicHttpOperation,
  type PublicHttpInventoryEntry,
} from "../../src/auth/public-http-authorization.js";
import { createWorkTogetherMembershipMemoryFake } from "../../src/auth/work-together-membership-memory.js";
import { createWorkTogetherPrincipalPolicy } from "../../src/auth/work-together-principal-policy.js";
import {
  createSqlitePrincipalAssertionReplayGuard,
  type PrincipalAssertionReplayGuard,
} from "../../src/auth/work-together-principal-replay-guard.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import {
  createResolvePrincipalMiddleware,
  requirePrincipal,
} from "../../src/request-context.js";
import { createApp } from "../../src/server.js";
import { errorToResponse } from "../../src/errors.js";
import { createTestAppHarness, testLogger } from "../helpers/test-app.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = join(HERE, "../../src");

const ISSUER = "https://work-together.example/issuer";
const CELL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WORKSPACE_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const SUBJECT = "user_2abcDEF0123456789";
const DISPLAY_NAME = "Ada Lovelace";
const KID = "wt-cell-1";
const JTI_A = "11111111-1111-4111-8111-111111111111";
const JTI_B = "22222222-2222-4222-8222-222222222222";
const BASE_TIME_MS = 1_700_000_000_000;
const BASE_TIME_SEC = Math.floor(BASE_TIME_MS / 1000);

const UNTYPED_ROUTE_FILES = [
  "routes/plugins.ts",
  "routes/plugin-catalog.ts",
  "routes/skills-registry.ts",
] as const;

type TestKeys = {
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  readonly nodePrivateKey: KeyObject;
  readonly nodePublicKey: KeyObject;
};

let keysPromise: Promise<TestKeys> | undefined;
const openDatabases: DbConnection[] = [];

function createTestDatabase(): DbConnection {
  const db = createConnection(":memory:");
  migrate(db);
  openDatabases.push(db);
  return db;
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()!.$client.close();
  }
});

async function testKeys(): Promise<TestKeys> {
  keysPromise ??= (async () => {
    const pair = await generateKeyPair("EdDSA", { extractable: true });
    const jwk = await exportJWK(pair.privateKey);
    if (
      typeof jwk.kty !== "string" ||
      typeof jwk.crv !== "string" ||
      typeof jwk.d !== "string" ||
      typeof jwk.x !== "string"
    ) {
      throw new Error("expected extractable Ed25519 JWK fields");
    }
    const nodePrivateKey = createPrivateKey({
      format: "jwk",
      key: { kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x },
    });
    return {
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      nodePrivateKey,
      nodePublicKey: createPublicKey(nodePrivateKey),
    };
  })();
  return keysPromise;
}

function baseClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    aud: CELL_ID,
    sub: SUBJECT,
    jti: JTI_A,
    iat: BASE_TIME_SEC,
    nbf: BASE_TIME_SEC,
    exp: BASE_TIME_SEC + 30,
    workspace_id: WORKSPACE_ID,
    membership_revision: "1",
    principal_kind: "human",
    display_name: DISPLAY_NAME,
    request_method: "GET",
    request_target: "/api/v1/projects",
    transport: "http",
    ...overrides,
  };
}

async function signClaims(
  claims: Record<string, unknown>,
  privateKey?: CryptoKey,
): Promise<string> {
  const keys = await testKeys();
  return new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader({
      alg: WORK_TOGETHER_PRINCIPAL_JWT_ALG,
      typ: WORK_TOGETHER_PRINCIPAL_JWT_TYP,
      kid: KID,
    })
    .sign(privateKey ?? keys.privateKey);
}

function requestFrom(args: {
  token?: string;
  method?: string;
  target?: string;
}) {
  return {
    method: args.method ?? "GET",
    target: args.target ?? "/api/v1/projects",
    transport: "http" as const,
    getHeader: (name: string) => {
      if (
        args.token !== undefined &&
        name.toLowerCase() === WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER
      ) {
        return args.token;
      }
      return undefined;
    },
  };
}

function createPolicy(args: {
  membership: ReturnType<typeof createWorkTogetherMembershipMemoryFake>;
  publicKey: CryptoKey;
  now?: () => number;
}) {
  const replayCalls: unknown[] = [];
  const replayGuard: PrincipalAssertionReplayGuard = {
    async consume(consumeArgs) {
      replayCalls.push(consumeArgs);
      return "consumed";
    },
  };
  return {
    policy: createWorkTogetherPrincipalPolicy({
      issuer: ISSUER,
      cellId: CELL_ID,
      workspaceId: WORKSPACE_ID,
      verificationKeys: { [KID]: args.publicKey },
      membershipVerifier: args.membership,
      replayGuard,
      now: args.now ?? (() => BASE_TIME_MS),
    }),
  };
}

function isRouteDefinition(
  value: unknown,
): value is { path: string; method: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { method?: unknown }).method === "string" &&
    "request" in value &&
    "response" in value
  );
}

function samplePathForPattern(pattern: string): string {
  return `${"/api/v1"}${pattern
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)\{\.\+\}/gu, "dir/file.txt")
    .replace(/\*/gu, "rest/path")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/gu, "id-1")}`;
}

function sampleMethod(entry: PublicHttpInventoryEntry): string {
  return entry.method === "ALL" ? "GET" : entry.method;
}

function scanUntypedRouteRegistrations(): Array<{
  method: string;
  pattern: string;
  file: string;
}> {
  const routeCall =
    /\bapp\.(get|post|put|patch|delete|all)\(\s*["']([^"']+)["']/gu;
  const found: Array<{ method: string; pattern: string; file: string }> = [];
  for (const relative of UNTYPED_ROUTE_FILES) {
    const source = readFileSync(join(SERVER_SRC, relative), "utf8");
    for (const match of source.matchAll(routeCall)) {
      found.push({
        method: match[1]!.toUpperCase(),
        pattern: match[2]!,
        file: relative,
      });
    }
  }
  return found;
}

describe("public HTTP authorization inventory", () => {
  it("contains exactly 141 typed + 28 untyped operations with unique names and pairs", () => {
    const typed = PUBLIC_HTTP_INVENTORY.filter(
      (entry) => entry.source === "typed",
    );
    const untyped = PUBLIC_HTTP_INVENTORY.filter(
      (entry) => entry.source === "untyped",
    );
    expect(typed).toHaveLength(145);
    expect(untyped).toHaveLength(28);
    expect(PUBLIC_HTTP_INVENTORY).toHaveLength(173);
    expect(UNTYPED_PUBLIC_HTTP_INVENTORY).toHaveLength(28);

    const names = PUBLIC_HTTP_INVENTORY.map((entry) => entry.operationName);
    expect(new Set(names).size).toBe(names.length);
    const pairs = PUBLIC_HTTP_INVENTORY.map(
      (entry) => `${entry.method} ${entry.pattern}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("matches every publicApiRoutes descriptor exactly (typed drift)", () => {
    const fromDescriptors: Array<{
      operationName: string;
      method: string;
      pattern: string;
    }> = [];
    for (const [group, groupRoutes] of Object.entries(publicApiRoutes)) {
      for (const [operation, descriptor] of Object.entries(groupRoutes)) {
        expect(isRouteDefinition(descriptor)).toBe(true);
        if (!isRouteDefinition(descriptor)) {
          continue;
        }
        fromDescriptors.push({
          operationName: `${group}.${operation}`,
          method: descriptor.method.toUpperCase(),
          pattern: descriptor.path,
        });
      }
    }
    const typed = PUBLIC_HTTP_INVENTORY.filter(
      (entry) => entry.source === "typed",
    ).map((entry) => ({
      operationName: entry.operationName,
      method: entry.method,
      pattern: entry.pattern,
    }));
    expect(typed).toEqual(fromDescriptors);
  });

  it("matches untyped route registrations in plugins/catalog/skills sources", () => {
    const registered = scanUntypedRouteRegistrations();
    expect(registered).toHaveLength(28);
    expect(
      registered.filter((entry) => entry.file === "routes/plugins.ts"),
    ).toHaveLength(20);
    expect(
      registered.filter((entry) => entry.file === "routes/plugin-catalog.ts"),
    ).toHaveLength(3);
    expect(
      registered.filter((entry) => entry.file === "routes/skills-registry.ts"),
    ).toHaveLength(5);

    const inventoryPairs = UNTYPED_PUBLIC_HTTP_INVENTORY.map(
      (entry) => `${entry.method} ${entry.pattern}`,
    ).sort();
    const registeredPairs = registered
      .map((entry) => `${entry.method} ${entry.pattern}`)
      .sort();
    expect(registeredPairs).toEqual(inventoryPairs);
  });
});

describe("public HTTP operation resolution", () => {
  it("lets static segments win over params and resolves greedy paths", () => {
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/plugins/updates"),
    ).toMatchObject({
      kind: "mapped",
      operationName: "plugins.updates",
      resource: { kind: "plugin", id: null },
    });
    expect(
      resolvePublicHttpOperation("DELETE", "/api/v1/plugins/plug-1"),
    ).toMatchObject({
      kind: "mapped",
      operationName: "plugins.delete",
      action: { name: "publicHttp.plugins.delete" },
      resource: { kind: "plugin", id: "plug-1" },
    });
    // Static `/plugins/updates` wins over param `:id` for the same method family.
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/plugins/contributions"),
    ).toMatchObject({
      kind: "mapped",
      operationName: "plugins.contributions",
      resource: { kind: "plugin", id: null },
    });
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/threads/search"),
    ).toMatchObject({
      kind: "mapped",
      operationName: "threads.search",
      resource: { kind: "thread", id: null },
    });
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/threads/thr-1"),
    ).toMatchObject({
      kind: "mapped",
      operationName: "threads.get",
      resource: { kind: "thread", id: "thr-1" },
    });
    expect(
      resolvePublicHttpOperation(
        "PATCH",
        "/api/v1/threads/thr-1/queued-messages/group-boundary",
      ),
    ).toMatchObject({
      kind: "mapped",
      operationName: "threads.setQueuedMessageGroupBoundary",
      resource: { kind: "thread", id: "thr-1" },
    });
    expect(
      resolvePublicHttpOperation(
        "PATCH",
        "/api/v1/threads/thr-1/queued-messages/qm-1",
      ),
    ).toMatchObject({
      kind: "mapped",
      operationName: "threads.updateQueuedMessage",
      resource: { kind: "thread", id: "thr-1" },
    });
    expect(
      resolvePublicHttpOperation(
        "GET",
        "/api/v1/file-previews/prev-1/nested/file.txt",
      ),
    ).toMatchObject({
      kind: "mapped",
      operationName: "filePreviews.content",
      resource: { kind: "filePreview", id: "prev-1" },
    });
    expect(
      resolvePublicHttpOperation(
        "PUT",
        "/api/v1/plugins/plug-1/http/deep/path",
      ),
    ).toMatchObject({
      kind: "mapped",
      operationName: "plugins.http",
      resource: { kind: "plugin", id: "plug-1" },
    });
    expect(
      resolvePublicHttpOperation(
        "GET",
        "/api/v1/threads/thr-1/worktree/files/a/b.ts",
      ),
    ).toMatchObject({
      kind: "mapped",
      operationName: "threads.worktreeFile",
      resource: { kind: "thread", id: "thr-1" },
    });
  });

  it("returns unmapped for wrong method, unknown path, and malformed inputs", () => {
    const unmapped = {
      kind: "unmapped",
      action: { name: PUBLIC_HTTP_UNMAPPED_ACTION_NAME },
      resource: { kind: "route", id: null },
    };
    expect(
      resolvePublicHttpOperation("POST", "/api/v1/projects"),
    ).toMatchObject({
      kind: "mapped",
      operationName: "projects.create",
    });
    expect(resolvePublicHttpOperation("DELETE", "/api/v1/projects")).toEqual(
      unmapped,
    );
    expect(resolvePublicHttpOperation("GET", "/api/v1/no-such-route")).toEqual(
      unmapped,
    );
    expect(resolvePublicHttpOperation("GET", "https://evil.test/x")).toEqual(
      unmapped,
    );
    expect(resolvePublicHttpOperation("GET", "//evil.test/x")).toEqual(
      unmapped,
    );
    expect(resolvePublicHttpOperation("GET", "/api/v1/projects?x=1")).toEqual(
      unmapped,
    );
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/projects/%2e%2e/hosts"),
    ).toEqual(unmapped);
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/projects/%2fhosts"),
    ).toEqual(unmapped);
    expect(resolvePublicHttpOperation("", "/api/v1/projects")).toEqual(
      unmapped,
    );
    expect(resolvePublicHttpOperation("get", "/api/v1/projects")).toEqual(
      unmapped,
    );
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/projects/../hosts"),
    ).toEqual(unmapped);
    expect(resolvePublicHttpOperation("GET", "/api/v1/projects/%41")).toEqual(
      unmapped,
    );
    expect(resolvePublicHttpOperation("GET", "")).toEqual(unmapped);
  });

  it("binds resource IDs only from matched path params", () => {
    const resolved = resolvePublicHttpOperation(
      "GET",
      "/api/v1/projects/proj-from-path",
    );
    expect(resolved).toMatchObject({
      kind: "mapped",
      operationName: "projects.get",
      resource: { kind: "project", id: "proj-from-path" },
    });
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/terminals/term-9"),
    ).toMatchObject({
      resource: { kind: "terminal", id: "term-9" },
    });
    expect(
      resolvePublicHttpOperation("GET", "/api/v1/system/providers/prov-1/logo"),
    ).toMatchObject({
      resource: { kind: "systemSettings", id: "prov-1" },
    });
    expect(
      resolvePublicHttpOperation("POST", "/api/v1/thread-sections"),
    ).toMatchObject({
      resource: { kind: "threadSection", id: null },
    });
  });

  it("resolves every inventory entry from a sample path", () => {
    for (const entry of PUBLIC_HTTP_INVENTORY) {
      const resolved = resolvePublicHttpOperation(
        sampleMethod(entry),
        samplePathForPattern(entry.pattern),
      );
      expect(resolved.kind).toBe("mapped");
      if (resolved.kind !== "mapped") {
        continue;
      }
      expect(resolved.operationName).toBe(entry.operationName);
      expect(resolved.action.name).toBe(
        `${PUBLIC_HTTP_ACTION_PREFIX}${entry.operationName}`,
      );
    }
  });
});

describe("public HTTP authorization predicates", () => {
  it("rejects forged action/resource mismatches", () => {
    expect(
      isRegistryIssuedPublicHttpAuthorization(
        { name: "publicHttp.projects.get" },
        { kind: "project", id: "p1" },
      ),
    ).toBe(true);
    expect(
      isRegistryIssuedPublicHttpAuthorization(
        { name: "publicHttp.projects.get" },
        { kind: "project", id: null },
      ),
    ).toBe(false);
    expect(
      isRegistryIssuedPublicHttpAuthorization(
        { name: "publicHttp.projects.list" },
        { kind: "thread", id: null },
      ),
    ).toBe(false);
    expect(
      isRegistryIssuedPublicHttpAuthorization(
        { name: PUBLIC_HTTP_UNMAPPED_ACTION_NAME },
        { kind: "route", id: null },
      ),
    ).toBe(false);
    expect(
      isMemberAllowedPublicHttpAuthorization(
        { name: "publicHttp.hosts.list" },
        { kind: "host", id: null },
      ),
    ).toBe(false);
    expect(
      isMemberAllowedPublicHttpAuthorization(
        { name: "publicHttp.projects.list" },
        { kind: "project", id: null },
      ),
    ).toBe(false);
    expect(
      isRegistryIssuedPublicHttpAuthorization(
        { name: "publicHttp.projects.get", extra: true } as never,
        { kind: "project", id: "p1" },
      ),
    ).toBe(false);
    expect(
      isRegistryIssuedPublicHttpAuthorization(
        { name: "publicHttp.projects.get" },
        { kind: "project", id: "../hosts" },
      ),
    ).toBe(false);
    expect(
      isRegistryIssuedPublicHttpAuthorization(
        { name: "publicHttp.projects.get" },
        { kind: "project", id: "p1", workspaceId: "other" } as never,
      ),
    ).toBe(false);
  });

  it("keeps host filesystem and discovery surfaces outside signed allowlists", () => {
    const forbidden = [
      "threads.hostFileContent",
      "threads.rawFile",
      "system.onboardingRepos",
      "system.onboardingAgents",
      "system.usageLimits",
      "system.themes",
      "system.config",
      "system.attention",
      "projects.copyAttachments",
    ];
    for (const operationName of forbidden) {
      expect(PUBLIC_HTTP_MEMBER_OPERATION_NAMES).not.toContain(operationName);
      expect(PUBLIC_HTTP_WORK_TOGETHER_OWNER_OPERATION_NAMES).not.toContain(
        operationName,
      );
    }
  });
});

describe("public HTTP authorization middleware", () => {
  it("invokes the request-scoped authorize closure before the handler", async () => {
    const calls: Array<{ action: string; resource: unknown }> = [];
    let handlerCalled = false;
    const policy: PrincipalPolicy = {
      async resolve() {
        return {
          principal: {
            id: "test-owner",
            kind: "human",
            displayName: "Test",
          },
          expiresAtMs: null,
          clientRealtimeScope: "unrestricted",
          async authorize(action, resource) {
            calls.push({ action: action.name, resource });
            return { allowed: true };
          },
        };
      },
    };
    const app = new Hono();
    app.use("*", createResolvePrincipalMiddleware(policy, "http"));
    app.use(
      "*",
      createPublicHttpAuthorizationMiddleware({ db: createTestDatabase() }),
    );
    app.get("/api/v1/projects", async (context) => {
      handlerCalled = true;
      return context.json({
        principal: requirePrincipal(context).id,
        handlerCalled,
      });
    });

    const response = await app.request("/api/v1/projects");
    expect(response.status).toBe(200);
    expect(handlerCalled).toBe(true);
    expect(calls).toEqual([
      {
        action: "publicHttp.projects.list",
        resource: { kind: "project", id: null },
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      principal: "test-owner",
      handlerCalled: true,
    });
  });

  it("denies without calling the handler and stays generic", async () => {
    let handlerCalled = false;
    const policy: PrincipalPolicy = {
      async resolve() {
        return {
          principal: {
            id: "member-1",
            kind: "human",
            displayName: "Member",
          },
          expiresAtMs: null,
          clientRealtimeScope: "unrestricted",
          async authorize() {
            return { allowed: false, reason: "forbidden" };
          },
        };
      },
    };
    const app = new Hono();
    app.onError((error) => errorToResponse(error, testLogger));
    app.use("*", createResolvePrincipalMiddleware(policy, "http"));
    app.use(
      "*",
      createPublicHttpAuthorizationMiddleware({ db: createTestDatabase() }),
    );
    app.get("/api/v1/hosts", () => {
      handlerCalled = true;
      return new Response("secret", { status: 200 });
    });

    const response = await app.request("/api/v1/hosts");
    expect(handlerCalled).toBe(false);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      code: "not_found",
      message: "Not found",
    });
    expect(JSON.stringify(body)).not.toContain("hosts");
  });

  it("maps personal thread and environment lineage to the closed fallback", async () => {
    const db = createTestDatabase();
    const personalProject = ensurePersonalProject(db);
    const host = upsertHost(db, noopNotifier, {
      id: "host-personal-scope",
      name: "test-host",
      type: "persistent",
    });
    const personalEnvironment = createEnvironment(db, noopNotifier, {
      projectId: personalProject.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const personalThread = createThread(db, noopNotifier, {
      projectId: personalProject.id,
      providerId: "test-provider",
      status: "idle",
    });
    const { project: standardProject } = createProject(db, noopNotifier, {
      name: "workspace project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/workspace-project",
      },
    });
    const standardEnvironment = createEnvironment(db, noopNotifier, {
      projectId: standardProject.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const standardThread = createThread(db, noopNotifier, {
      projectId: standardProject.id,
      providerId: "test-provider",
      status: "idle",
    });
    const calls: Array<{ action: string; resource: unknown }> = [];
    let handlerCalled = false;
    const policy: PrincipalPolicy = {
      async resolve() {
        return {
          principal: {
            id: "member-1",
            kind: "human",
            displayName: "Member",
          },
          expiresAtMs: null,
          clientRealtimeScope: "unrestricted",
          async authorize(action, resource) {
            calls.push({ action: action.name, resource });
            return action.name === PUBLIC_HTTP_UNMAPPED_ACTION_NAME
              ? { allowed: false as const, reason: "forbidden" as const }
              : { allowed: true as const };
          },
        };
      },
    };
    const app = new Hono();
    app.onError((error) => errorToResponse(error, testLogger));
    app.use("*", createResolvePrincipalMiddleware(policy, "http"));
    app.use("*", createPublicHttpAuthorizationMiddleware({ db }));
    app.get("/api/v1/threads/:id", () => {
      handlerCalled = true;
      return new Response("secret");
    });
    app.get("/api/v1/environments/:id", () => {
      handlerCalled = true;
      return new Response("secret");
    });
    app.get("/api/v1/projects/:id/prompt-history", () => {
      handlerCalled = true;
      return new Response("secret");
    });

    for (const path of [
      `/api/v1/threads/${personalThread.id}`,
      `/api/v1/environments/${personalEnvironment.id}`,
      `/api/v1/projects/${personalProject.id}/prompt-history`,
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        code: "not_found",
        message: "Not found",
      });
    }
    expect(handlerCalled).toBe(false);
    expect(calls).toEqual([
      {
        action: PUBLIC_HTTP_UNMAPPED_ACTION_NAME,
        resource: { kind: "route", id: null },
      },
      {
        action: PUBLIC_HTTP_UNMAPPED_ACTION_NAME,
        resource: { kind: "route", id: null },
      },
      {
        action: PUBLIC_HTTP_UNMAPPED_ACTION_NAME,
        resource: { kind: "route", id: null },
      },
    ]);

    for (const path of [
      `/api/v1/threads/${standardThread.id}`,
      `/api/v1/environments/${standardEnvironment.id}`,
      `/api/v1/projects/${standardProject.id}/prompt-history`,
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
    }
    expect(handlerCalled).toBe(true);
    expect(calls.slice(3)).toEqual([
      {
        action: "publicHttp.threads.get",
        resource: { kind: "thread", id: standardThread.id },
      },
      {
        action: "publicHttp.environments.get",
        resource: { kind: "environment", id: standardEnvironment.id },
      },
      {
        action: "publicHttp.projects.promptHistory",
        resource: { kind: "project", id: standardProject.id },
      },
    ]);
  });
});

describe("signed Work Together public HTTP authorize", () => {
  it("allows Work Together owners only the closed Room-facing allowlist", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const session = await policy.resolve(
      requestFrom({ token: await signClaims(baseClaims()) }),
    );

    const allowed: string[] = [];
    const denied: string[] = [];
    for (const entry of PUBLIC_HTTP_INVENTORY) {
      const resolved = resolvePublicHttpOperation(
        sampleMethod(entry),
        samplePathForPattern(entry.pattern),
      );
      expect(resolved.kind).toBe("mapped");
      if (resolved.kind !== "mapped") {
        continue;
      }
      const decision = await session.authorize(
        resolved.action,
        resolved.resource,
      );
      if (
        PUBLIC_HTTP_WORK_TOGETHER_OWNER_OPERATION_NAMES.includes(
          entry.operationName,
        )
      ) {
        expect(decision).toEqual({ allowed: true });
        allowed.push(entry.operationName);
      } else {
        expect(decision).toEqual({ allowed: false, reason: "forbidden" });
        denied.push(entry.operationName);
      }
    }
    expect(allowed.sort()).toEqual(
      [...PUBLIC_HTTP_WORK_TOGETHER_OWNER_OPERATION_NAMES].sort(),
    );
    expect(allowed).toHaveLength(65);
    expect(denied).toHaveLength(173 - 65);
  });

  it("allows members only the conservative allowlist and denies the rest", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const session = await policy.resolve(
      requestFrom({ token: await signClaims(baseClaims()) }),
    );

    const allowed: string[] = [];
    const denied: string[] = [];
    for (const entry of PUBLIC_HTTP_INVENTORY) {
      const resolved = resolvePublicHttpOperation(
        sampleMethod(entry),
        samplePathForPattern(entry.pattern),
      );
      expect(resolved.kind).toBe("mapped");
      if (resolved.kind !== "mapped") {
        continue;
      }
      const decision = await session.authorize(
        resolved.action,
        resolved.resource,
      );
      if (PUBLIC_HTTP_MEMBER_OPERATION_NAMES.includes(entry.operationName)) {
        expect(decision).toEqual({ allowed: true });
        allowed.push(entry.operationName);
      } else {
        expect(decision).toEqual({ allowed: false, reason: "forbidden" });
        denied.push(entry.operationName);
      }
    }
    expect(allowed.sort()).toEqual(
      [...PUBLIC_HTTP_MEMBER_OPERATION_NAMES].sort(),
    );
    expect(allowed).toHaveLength(62);
    expect(denied).toHaveLength(173 - 62);
  });

  it("fails closed for malformed action/resource, stale revision, and removal", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const session = await policy.resolve(
      requestFrom({ token: await signClaims(baseClaims()) }),
    );

    await expect(
      session.authorize({ name: "x" }, { kind: "y", id: null }),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      session.authorize(
        { name: "publicHttp.projects.get" },
        { kind: "project", id: null },
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      session.authorize(
        { name: PUBLIC_HTTP_UNMAPPED_ACTION_NAME },
        { kind: "route", id: null },
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });

    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "2",
    });
    await expect(
      session.authorize(
        { name: "publicHttp.projects.list" },
        { kind: "project", id: null },
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });

    membership.removeMembership({ cellId: CELL_ID, subject: SUBJECT });
    await expect(
      session.authorize(
        { name: "publicHttp.projects.list" },
        { kind: "project", id: null },
      ),
    ).resolves.toEqual({ allowed: false, reason: "unauthenticated" });
  });

  it("uses the freshly validated membership role, not a caller-supplied role", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const session = await policy.resolve(
      requestFrom({
        token: await signClaims(baseClaims({ jti: JTI_B })),
      }),
    );

    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "1",
    });
    await expect(
      session.authorize(
        { name: "publicHttp.hosts.list" },
        { kind: "host", id: null },
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      session.authorize(
        { name: "publicHttp.projects.get" },
        { kind: "project", id: "project-1" },
      ),
    ).resolves.toEqual({ allowed: true });
  });
});

describe("createApp public HTTP authorization boundary", () => {
  it("keeps local-owner known and unknown behavior", async () => {
    const harness = await createTestAppHarness();
    try {
      const known = await harness.app.request("/api/v1/projects");
      expect(known.status).toBe(200);

      const operatorRoute = await harness.app.request("/api/v1/hosts");
      expect(operatorRoute.status).toBe(200);

      const unknown = await harness.app.request("/api/v1/definitely-missing");
      expect(unknown.status).toBe(404);
      await expect(unknown.json()).resolves.toEqual({
        code: "not_found",
        message: "Not found",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("enforces signed member/owner decisions before handlers", async () => {
    const harness = await createTestAppHarness();
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "1",
    });
    const db = createConnection(":memory:");
    migrate(db);
    openDatabases.push(db);
    const replayGuard = createSqlitePrincipalAssertionReplayGuard({ db });
    const policy = createWorkTogetherPrincipalPolicy({
      issuer: ISSUER,
      cellId: CELL_ID,
      workspaceId: WORKSPACE_ID,
      verificationKeys: { [KID]: publicKey },
      membershipVerifier: membership,
      replayGuard,
      now: () => BASE_TIME_MS,
    });
    const server = createApp(harness.deps, { principalPolicy: policy });

    async function signedRequest(
      method: string,
      path: string,
      jti: string,
    ): Promise<Response> {
      const token = await signClaims(
        baseClaims({
          jti,
          request_method: method,
          request_target: path,
        }),
      );
      return server.app.request(path, {
        method,
        headers: {
          [WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER]: token,
        },
      });
    }

    try {
      const projects = await signedRequest(
        "GET",
        "/api/v1/projects",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      );
      expect(projects.status).toBe(404);

      const hosts = await signedRequest(
        "GET",
        "/api/v1/hosts",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      );
      expect(hosts.status).toBe(404);
      await expect(hosts.json()).resolves.toEqual({
        code: "not_found",
        message: "Not found",
      });

      const settings = await signedRequest(
        "PUT",
        "/api/v1/settings/general",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      );
      expect(settings.status).toBe(404);

      const plugins = await signedRequest(
        "GET",
        "/api/v1/plugins",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
      );
      expect(plugins.status).toBe(404);

      const terminals = await signedRequest(
        "GET",
        "/api/v1/terminals",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
      );
      expect(terminals.status).toBe(404);

      const envAction = await signedRequest(
        "POST",
        "/api/v1/environments/env-1/actions",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
      );
      expect(envAction.status).toBe(404);

      const unknown = await signedRequest(
        "GET",
        "/api/v1/definitely-missing",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7",
      );
      expect(unknown.status).toBe(404);

      membership.setMembership({
        cellId: CELL_ID,
        subject: SUBJECT,
        role: "owner",
        membershipRevision: "1",
      });
      const ownerHosts = await signedRequest(
        "GET",
        "/api/v1/hosts",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8",
      );
      expect(ownerHosts.status).toBe(404);

      const ownerUnknown = await signedRequest(
        "GET",
        "/api/v1/definitely-missing",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
      );
      expect(ownerUnknown.status).toBe(404);
    } finally {
      await server.closeWebSockets();
      await harness.cleanup();
    }
  });

  it("allows signed member resource-bound reads past auth", async () => {
    const harness = await createTestAppHarness();
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "1",
    });
    const db = createConnection(":memory:");
    migrate(db);
    openDatabases.push(db);
    const policy = createWorkTogetherPrincipalPolicy({
      issuer: ISSUER,
      cellId: CELL_ID,
      workspaceId: WORKSPACE_ID,
      verificationKeys: { [KID]: publicKey },
      membershipVerifier: membership,
      replayGuard: createSqlitePrincipalAssertionReplayGuard({ db }),
      now: () => BASE_TIME_MS,
    });
    const server = createApp(harness.deps, { principalPolicy: policy });
    try {
      const projectToken = await signClaims(
        baseClaims({
          jti: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
          request_method: "GET",
          request_target: "/api/v1/projects/project-missing",
        }),
      );
      const projectResponse = await server.app.request(
        "/api/v1/projects/project-missing",
        {
          headers: {
            [WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER]: projectToken,
          },
        },
      );
      expect(projectResponse.status).toBeGreaterThanOrEqual(400);
      expect(projectResponse.status).not.toBe(401);

      const sendToken = await signClaims(
        baseClaims({
          jti: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
          request_method: "POST",
          request_target: "/api/v1/threads/thr-missing/send",
        }),
      );
      const sendResponse = await server.app.request(
        "/api/v1/threads/thr-missing/send",
        {
          method: "POST",
          headers: {
            [WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER]: sendToken,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: "hi" }),
        },
      );
      // Member send is authorized; missing thread fails in the handler, not auth.
      expect(sendResponse.status).toBeGreaterThanOrEqual(400);
      expect(sendResponse.status).not.toBe(401);
      const sendBody = await sendResponse.json();
      expect(sendBody.message).not.toBe("Not found");
    } finally {
      await server.closeWebSockets();
      await harness.cleanup();
    }
  });
});
