import { createConnection, migrate, type DbConnection } from "@bb/db";
import { generateKeyPair, exportJWK } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_OWNER_PRINCIPAL } from "../../src/auth/local-owner-adapter.js";
import * as databaseSession from "../../src/auth/work-together-membership-database-session.js";
import * as positiveCache from "../../src/auth/work-together-membership-positive-cache.js";
import * as principalPolicy from "../../src/auth/work-together-principal-policy.js";
import * as replayGuard from "../../src/auth/work-together-principal-replay-guard.js";
import {
  ServerPrincipalConfigurationError,
  closeServerPrincipalRuntimeBestEffort,
  createServerListenOptions,
  createServerPrincipalRuntime,
  type ServerPrincipalPgPool,
} from "../../src/auth/server-principal-runtime.js";

const ISSUER = "https://work-together.example/issuer";
const CELL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WORKSPACE_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const KID = "wt-cell-1";
const OTHER_KID = "wt-cell-2";
const DATABASE_URL = "postgres://work-together:secret@127.0.0.1:5432/wt";

const openDatabases: DbConnection[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (openDatabases.length > 0) {
    openDatabases.pop()!.$client.close();
  }
});

async function openDb(): Promise<DbConnection> {
  const db = createConnection(":memory:");
  migrate(db);
  openDatabases.push(db);
  return db;
}

async function ed25519PublicX(): Promise<{
  readonly x: string;
  readonly d: string;
}> {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = await exportJWK(pair.privateKey);
  if (typeof jwk.x !== "string" || typeof jwk.d !== "string") {
    throw new Error("expected extractable Ed25519 JWK fields");
  }
  return { x: jwk.x, d: jwk.d };
}

function validWorkTogetherEnv(keysJson: string): NodeJS.ProcessEnv {
  return {
    BB_PRINCIPAL_MODE: "work-together",
    BB_WORK_TOGETHER_ISSUER: ISSUER,
    BB_WORK_TOGETHER_CELL_ID: CELL_ID,
    BB_WORK_TOGETHER_WORKSPACE_ID: WORKSPACE_ID,
    BB_WORK_TOGETHER_VERIFICATION_KEYS: keysJson,
    BB_WORK_TOGETHER_MEMBERSHIP_DATABASE_URL: DATABASE_URL,
  };
}

function createRecordingPool(): {
  readonly pool: ServerPrincipalPgPool;
  readonly end: ReturnType<typeof vi.fn>;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly configs: Array<{ connectionString: string; max: number }>;
} {
  const configs: Array<{ connectionString: string; max: number }> = [];
  const end = vi.fn(async () => undefined);
  const connect = vi.fn(async () => {
    throw new Error("test pool must not connect");
  });
  return {
    configs,
    end,
    connect,
    pool: { connect, end },
  };
}

function expectSanitizedConfigError(error: unknown, secrets: string[]): void {
  expect(error).toBeInstanceOf(ServerPrincipalConfigurationError);
  if (!(error instanceof Error)) {
    throw new Error("expected Error");
  }
  expect(error.message).toBe("Invalid server principal configuration");
  expect(error.name).toBe("ServerPrincipalConfigurationError");
  const blob = `${error.message}\n${error.stack ?? ""}\n${String(error)}`;
  for (const secret of secrets) {
    expect(blob).not.toContain(secret);
  }
}

describe("createServerPrincipalRuntime local-owner", () => {
  it("defaults to local-owner with no pool and no forced hostname", async () => {
    const db = await openDb();
    const createPool = vi.fn(() => {
      throw new Error("pool must not be created");
    });

    const runtime = await createServerPrincipalRuntime({
      db,
      env: {},
      createPool,
    });

    expect(createPool).not.toHaveBeenCalled();
    expect(runtime.principalMode).toBe("local-owner");
    expect(runtime.hostname).toBeUndefined();
    expect(Object.isFrozen(runtime)).toBe(true);

    const resolved = await runtime.principalPolicy.resolve({
      method: "GET",
      target: "/api/v1/projects",
      transport: "http",
      getHeader: () => undefined,
    });
    expect(resolved.principal).toEqual(LOCAL_OWNER_PRINCIPAL);

    await runtime.close();
    await runtime.close();
  });

  it("treats explicit local-owner the same as missing mode", async () => {
    const db = await openDb();
    const createPool = vi.fn(() => {
      throw new Error("pool must not be created");
    });

    const runtime = await createServerPrincipalRuntime({
      db,
      env: { BB_PRINCIPAL_MODE: "local-owner" },
      createPool,
    });

    expect(createPool).not.toHaveBeenCalled();
    expect(runtime.principalMode).toBe("local-owner");
    expect(runtime.hostname).toBeUndefined();
  });
});

describe("createServerPrincipalRuntime work-together", () => {
  it("imports keys, creates max-2 pool, composes adapters, binds loopback, and ends once", async () => {
    const db = await openDb();
    const { x } = await ed25519PublicX();
    const keysJson = JSON.stringify({ [KID]: x });
    const recording = createRecordingPool();
    const createPool = vi.fn(
      (config: { connectionString: string; max: number }) => {
        recording.configs.push(config);
        return recording.pool;
      },
    );

    const databaseSpy = vi.spyOn(
      databaseSession,
      "createWorkTogetherMembershipDatabaseSessionAdapter",
    );
    const cacheSpy = vi.spyOn(
      positiveCache,
      "createWorkTogetherMembershipPositiveCache",
    );
    const replaySpy = vi.spyOn(
      replayGuard,
      "createSqlitePrincipalAssertionReplayGuard",
    );
    const policySpy = vi.spyOn(
      principalPolicy,
      "createWorkTogetherPrincipalPolicy",
    );

    const runtime = await createServerPrincipalRuntime({
      db,
      env: validWorkTogetherEnv(keysJson),
      createPool,
    });

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith({
      connectionString: DATABASE_URL,
      max: 2,
    });
    expect(recording.configs).toEqual([
      { connectionString: DATABASE_URL, max: 2 },
    ]);
    expect(recording.connect).not.toHaveBeenCalled();

    expect(databaseSpy).toHaveBeenCalledTimes(1);
    expect(cacheSpy).toHaveBeenCalledTimes(1);
    expect(cacheSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        ttlMs: 5_000,
        maxEntries: 10_000,
        delegate: expect.any(Object),
      }),
    );
    expect(replaySpy).toHaveBeenCalledTimes(1);
    expect(replaySpy).toHaveBeenCalledWith({ db });
    expect(policySpy).toHaveBeenCalledTimes(1);

    const policyArgs = policySpy.mock.calls[0]![0]!;
    expect(policyArgs.issuer).toBe(ISSUER);
    expect(policyArgs.cellId).toBe(CELL_ID);
    expect(policyArgs.workspaceId).toBe(WORKSPACE_ID);
    expect(policyArgs.membershipVerifier).toBe(cacheSpy.mock.results[0]!.value);
    expect(policyArgs.replayGuard).toBe(replaySpy.mock.results[0]!.value);

    const keys = policyArgs.verificationKeys;
    const keyMap = keys instanceof Map ? keys : new Map(Object.entries(keys));
    expect(keyMap.size).toBe(1);
    expect(keyMap.has(KID)).toBe(true);
    expect(keyMap.get(KID)).toBeInstanceOf(CryptoKey);

    expect(runtime.principalMode).toBe("work-together");
    expect(runtime.hostname).toBe("127.0.0.1");
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(runtime.principalPolicy).toBe(policySpy.mock.results[0]!.value);

    await runtime.close();
    await runtime.close();
    expect(recording.end).toHaveBeenCalledTimes(1);
  });

  it("accepts two verification keys and optional replay capacity", async () => {
    const db = await openDb();
    const first = await ed25519PublicX();
    const second = await ed25519PublicX();
    const keysJson = JSON.stringify({
      [KID]: first.x,
      [OTHER_KID]: second.x,
    });
    const recording = createRecordingPool();
    const replaySpy = vi.spyOn(
      replayGuard,
      "createSqlitePrincipalAssertionReplayGuard",
    );

    const runtime = await createServerPrincipalRuntime({
      db,
      env: {
        ...validWorkTogetherEnv(keysJson),
        BB_WORK_TOGETHER_REPLAY_MAX_ENTRIES: "100000",
      },
      createPool: () => recording.pool,
    });

    expect(replaySpy).toHaveBeenCalledWith({
      db,
      maxEntries: 100_000,
    });
    expect(runtime.hostname).toBe("127.0.0.1");
    await runtime.close();
  });
});

describe("createServerPrincipalRuntime configuration errors", () => {
  const secrets = [
    DATABASE_URL,
    "work-together:secret",
    ISSUER,
    CELL_ID,
    WORKSPACE_ID,
    KID,
    OTHER_KID,
    "postgres://",
  ];

  async function expectConfigFailure(
    env: NodeJS.ProcessEnv,
    extraSecrets: string[] = [],
  ): Promise<void> {
    const db = await openDb();
    const recording = createRecordingPool();
    try {
      await createServerPrincipalRuntime({
        db,
        env,
        createPool: (config) => {
          recording.configs.push(config);
          return recording.pool;
        },
      });
      throw new Error("expected configuration failure");
    } catch (error) {
      expectSanitizedConfigError(error, [...secrets, ...extraSecrets]);
    }
    expect(recording.end.mock.calls.length).toBeLessThanOrEqual(1);
  }

  it("rejects unknown and tempting memory/test mode selectors", async () => {
    for (const mode of [
      "memory",
      "test",
      "work-together-memory",
      "local-owner ",
      " work-together",
      "",
      "LOCAL-OWNER",
      "Work-Together",
    ]) {
      await expectConfigFailure({
        ...validWorkTogetherEnv("{}"),
        BB_PRINCIPAL_MODE: mode,
        NODE_ENV: "production",
      });
    }
  });

  it("rejects missing required work-together env vars", async () => {
    const { x } = await ed25519PublicX();
    const base = validWorkTogetherEnv(JSON.stringify({ [KID]: x }));
    for (const missing of [
      "BB_WORK_TOGETHER_ISSUER",
      "BB_WORK_TOGETHER_CELL_ID",
      "BB_WORK_TOGETHER_WORKSPACE_ID",
      "BB_WORK_TOGETHER_VERIFICATION_KEYS",
      "BB_WORK_TOGETHER_MEMBERSHIP_DATABASE_URL",
    ] as const) {
      const env = { ...base };
      delete env[missing];
      await expectConfigFailure(env);
    }
  });

  it("rejects empty required work-together env vars", async () => {
    const { x } = await ed25519PublicX();
    const base = validWorkTogetherEnv(JSON.stringify({ [KID]: x }));
    for (const name of [
      "BB_WORK_TOGETHER_ISSUER",
      "BB_WORK_TOGETHER_CELL_ID",
      "BB_WORK_TOGETHER_WORKSPACE_ID",
      "BB_WORK_TOGETHER_VERIFICATION_KEYS",
      "BB_WORK_TOGETHER_MEMBERSHIP_DATABASE_URL",
    ] as const) {
      await expectConfigFailure({ ...base, [name]: "" });
      await expectConfigFailure({ ...base, [name]: "   " });
      await expectConfigFailure({ ...base, [name]: ` ${base[name]}` });
    }
  });

  it("sanitizes a malformed injected environment", async () => {
    const db = await openDb();
    await expect(
      createServerPrincipalRuntime({ db, env: null as never }),
    ).rejects.toBeInstanceOf(ServerPrincipalConfigurationError);
  });

  it("rejects malformed verification key documents", async () => {
    const { x, d } = await ed25519PublicX();
    const cases: Array<{ json: string; extra?: string[] }> = [
      { json: "[]" },
      { json: "null" },
      { json: `"${x}"` },
      { json: "{}" },
      { json: JSON.stringify({ [KID]: x, [OTHER_KID]: x, "wt-cell-3": x }) },
      { json: `{"${KID}":"${x}","${KID}":"${x}"}` },
      { json: JSON.stringify({ [KID]: { kty: "OKP", crv: "Ed25519", x } }) },
      {
        json: JSON.stringify({
          [KID]: { kty: "OKP", crv: "Ed25519", x, d },
        }),
        extra: [d],
      },
      { json: JSON.stringify({ [KID]: x, alg: "EdDSA" }) },
      { json: JSON.stringify({ "bad kid!": x }) },
      { json: JSON.stringify({ [KID]: "not-valid-base64url*" }) },
      { json: JSON.stringify({ [KID]: "" }) },
      { json: `{"${KID}":"${x}",}` },
      { json: `{"${KID}": "${x}" /* comment */}` },
      { json: JSON.stringify({ [KID]: 1 }) },
      { json: JSON.stringify({ [KID]: null }) },
    ];

    for (const testCase of cases) {
      await expectConfigFailure(validWorkTogetherEnv(testCase.json), [
        x,
        ...(testCase.extra ?? []),
      ]);
    }
  });

  it("rejects invalid cell/workspace values through sanitized config errors", async () => {
    const { x } = await ed25519PublicX();
    const keysJson = JSON.stringify({ [KID]: x });
    await expectConfigFailure({
      ...validWorkTogetherEnv(keysJson),
      BB_WORK_TOGETHER_CELL_ID: "not-a-uuid",
    });
    await expectConfigFailure({
      ...validWorkTogetherEnv(keysJson),
      BB_WORK_TOGETHER_WORKSPACE_ID: "NOT-LOWERCASE-UUID",
    });
  });

  it("rejects non-canonical replay max entries", async () => {
    const { x } = await ed25519PublicX();
    const keysJson = JSON.stringify({ [KID]: x });
    for (const value of [
      "0",
      "01",
      "+1",
      "-1",
      "1e3",
      "1.5",
      " 1",
      "1 ",
      "100001",
      "999999",
    ]) {
      await expectConfigFailure({
        ...validWorkTogetherEnv(keysJson),
        BB_WORK_TOGETHER_REPLAY_MAX_ENTRIES: value,
      });
    }
  });
});

describe("server principal listen options and close helper", () => {
  it("omits hostname for local-owner and forces loopback for work-together", async () => {
    const db = await openDb();
    const local = await createServerPrincipalRuntime({
      db,
      env: { BB_PRINCIPAL_MODE: "local-owner" },
    });
    const fetch = vi.fn();
    expect(
      createServerListenOptions({
        port: 1234,
        fetch,
        principalRuntime: local,
      }),
    ).toEqual({ port: 1234, fetch });

    const { x } = await ed25519PublicX();
    const recording = createRecordingPool();
    const workTogether = await createServerPrincipalRuntime({
      db,
      env: validWorkTogetherEnv(JSON.stringify({ [KID]: x })),
      createPool: () => recording.pool,
    });
    expect(
      createServerListenOptions({
        port: 1234,
        fetch,
        principalRuntime: workTogether,
      }),
    ).toEqual({
      port: 1234,
      fetch,
      hostname: "127.0.0.1",
    });
    await workTogether.close();
  });

  it("closeServerPrincipalRuntimeBestEffort swallows close failures", async () => {
    const close = vi.fn(async () => {
      throw new Error(`close boom ${DATABASE_URL}`);
    });
    await expect(
      closeServerPrincipalRuntimeBestEffort({
        principalPolicy: {
          async resolve() {
            throw new Error("unused");
          },
        },
        principalMode: "work-together",
        hostname: "127.0.0.1",
        close,
      }),
    ).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("start-server principal wiring", () => {
  it("passes principal policy and listen options and closes in finally", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../src/start-server.ts",
      ),
      "utf8",
    );

    expect(source).toContain("createServerPrincipalRuntime({ db })");
    expect(source).toContain(
      "principalPolicy: principalRuntime.principalPolicy",
    );
    expect(source).toContain("createServerListenOptions({");
    expect(source).toContain(
      "closeServerPrincipalRuntimeBestEffort(principalRuntime)",
    );
    expect(source).toContain("finally {");
    expect(source).not.toContain("BB_WORK_TOGETHER_MEMBERSHIP_DATABASE_URL");
    expect(source).not.toContain("BB_WORK_TOGETHER_VERIFICATION_KEYS");
  });
});
