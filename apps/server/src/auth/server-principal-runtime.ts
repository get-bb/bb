import type { DbConnection } from "@bb/db";
import {
  getNodeValue,
  parseTree,
  type Node,
  type ParseError,
} from "jsonc-parser";
import { importJWK, type JWK } from "jose";
import { Pool } from "pg";
import { createLocalOwnerPrincipalPolicy } from "./local-owner-adapter.js";
import type { PrincipalPolicy } from "./principal-policy.js";
import { createWorkTogetherMembershipDatabaseSessionAdapter } from "./work-together-membership-database-session.js";
import type {
  WorkTogetherMembershipSqlClient,
  WorkTogetherMembershipSqlPool,
} from "./work-together-membership-database-session.js";
import { createWorkTogetherMembershipPositiveCache } from "./work-together-membership-positive-cache.js";
import { createWorkTogetherPrincipalPolicy } from "./work-together-principal-policy.js";
import { createSqlitePrincipalAssertionReplayGuard } from "./work-together-principal-replay-guard.js";
import type { WorkTogetherPrincipalVerificationKey } from "./work-together-principal-verifier.js";

const PRINCIPAL_MODE_LOCAL_OWNER = "local-owner";
const PRINCIPAL_MODE_WORK_TOGETHER = "work-together";
const WORK_TOGETHER_LISTEN_HOSTNAME = "127.0.0.1";
const WORK_TOGETHER_POOL_MAX = 2;
const WORK_TOGETHER_MEMBERSHIP_CACHE_TTL_MS = 5_000;
const WORK_TOGETHER_MEMBERSHIP_CACHE_MAX_ENTRIES = 10_000;
const MIN_REPLAY_MAX_ENTRIES = 1;
const MAX_REPLAY_MAX_ENTRIES = 100_000;
const ED25519_PUBLIC_X_BYTES = 32;
const KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const REPLAY_MAX_ENTRIES_PATTERN = /^[1-9][0-9]{0,5}$/u;

const ENV_PRINCIPAL_MODE = "BB_PRINCIPAL_MODE";
const ENV_ISSUER = "BB_WORK_TOGETHER_ISSUER";
const ENV_CELL_ID = "BB_WORK_TOGETHER_CELL_ID";
const ENV_WORKSPACE_ID = "BB_WORK_TOGETHER_WORKSPACE_ID";
const ENV_VERIFICATION_KEYS = "BB_WORK_TOGETHER_VERIFICATION_KEYS";
const ENV_MEMBERSHIP_DATABASE_URL = "BB_WORK_TOGETHER_MEMBERSHIP_DATABASE_URL";
const ENV_REPLAY_MAX_ENTRIES = "BB_WORK_TOGETHER_REPLAY_MAX_ENTRIES";

/**
 * Sanitized principal-mode configuration failure.
 *
 * Never echoes env values, URLs, key material, kids, issuers, workspaces, or
 * parser/driver details.
 */
export class ServerPrincipalConfigurationError extends Error {
  constructor() {
    super("Invalid server principal configuration");
    this.name = "ServerPrincipalConfigurationError";
  }
}

export function rejectServerPrincipalConfiguration(): never {
  throw new ServerPrincipalConfigurationError();
}

export type ServerPrincipalRuntime = {
  readonly principalPolicy: PrincipalPolicy;
  readonly principalMode:
    | typeof PRINCIPAL_MODE_LOCAL_OWNER
    | typeof PRINCIPAL_MODE_WORK_TOGETHER;
  readonly hostname: string | undefined;
  readonly workTogetherRoomTaskRuntime: Readonly<{
    pool: ServerPrincipalPgPool;
    cellId: string;
    workspaceId: string;
  }> | null;
  readonly close: () => Promise<void>;
};

/**
 * Minimal pool surface used by startup. Tests inject fakes; production uses pg.
 */
export type ServerPrincipalPgPool = {
  connect(): Promise<{
    query(queryText: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
  end(): Promise<void>;
};

export type CreateServerPrincipalPgPoolConfig = {
  readonly connectionString: string;
  readonly max: number;
};

export type CreateServerPrincipalRuntimeOptions = {
  readonly db: DbConnection;
  readonly env?: NodeJS.ProcessEnv;
  readonly createPool?: (
    config: CreateServerPrincipalPgPoolConfig,
  ) => ServerPrincipalPgPool;
};

type WorkTogetherEnvConfig = {
  readonly issuer: string;
  readonly cellId: string;
  readonly workspaceId: string;
  readonly membershipDatabaseUrl: string;
  readonly verificationKeysJson: string;
  readonly replayMaxEntries: number | undefined;
};

/**
 * Build the PrincipalPolicy runtime used by `runServer`.
 *
 * Missing/`local-owner` preserves stock behavior. Exact `work-together` composes
 * the signed adapter. Every other mode value is a sanitized configuration error.
 */
export async function createServerPrincipalRuntime(
  options: CreateServerPrincipalRuntimeOptions,
): Promise<ServerPrincipalRuntime> {
  if (options === null || typeof options !== "object" || options.db == null) {
    rejectServerPrincipalConfiguration();
  }

  const env = options.env === undefined ? process.env : options.env;
  if (env === null || typeof env !== "object") {
    rejectServerPrincipalConfiguration();
  }
  const mode = readPrincipalMode(env);

  if (mode === PRINCIPAL_MODE_LOCAL_OWNER) {
    return freezeRuntime({
      principalPolicy: createLocalOwnerPrincipalPolicy(),
      principalMode: PRINCIPAL_MODE_LOCAL_OWNER,
      hostname: undefined,
      workTogetherRoomTaskRuntime: null,
      close: async () => undefined,
    });
  }

  const config = readWorkTogetherEnvConfig(env);
  const verificationKeys = await importVerificationKeys(
    config.verificationKeysJson,
  );
  const createPool = options.createPool ?? createDefaultPgPool;
  let pool: ServerPrincipalPgPool;
  try {
    pool = createPool({
      connectionString: config.membershipDatabaseUrl,
      max: WORK_TOGETHER_POOL_MAX,
    });
  } catch {
    rejectServerPrincipalConfiguration();
  }

  try {
    const membershipPool = adaptPgPool(pool);
    const membershipVerifier = createWorkTogetherMembershipPositiveCache({
      delegate:
        createWorkTogetherMembershipDatabaseSessionAdapter(membershipPool),
      ttlMs: WORK_TOGETHER_MEMBERSHIP_CACHE_TTL_MS,
      maxEntries: WORK_TOGETHER_MEMBERSHIP_CACHE_MAX_ENTRIES,
    });
    const replayGuard = createSqlitePrincipalAssertionReplayGuard({
      db: options.db,
      ...(config.replayMaxEntries !== undefined
        ? { maxEntries: config.replayMaxEntries }
        : {}),
    });
    const principalPolicy = createWorkTogetherPrincipalPolicy({
      issuer: config.issuer,
      cellId: config.cellId,
      workspaceId: config.workspaceId,
      verificationKeys,
      membershipVerifier,
      replayGuard,
    });

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) {
        return;
      }
      closed = true;
      await pool.end();
    };

    return freezeRuntime({
      principalPolicy,
      principalMode: PRINCIPAL_MODE_WORK_TOGETHER,
      hostname: WORK_TOGETHER_LISTEN_HOSTNAME,
      workTogetherRoomTaskRuntime: Object.freeze({
        pool,
        cellId: config.cellId,
        workspaceId: config.workspaceId,
      }),
      close,
    });
  } catch {
    await endPoolBestEffort(pool);
    rejectServerPrincipalConfiguration();
  }
}

/**
 * Build `@hono/node-server` listen options, forcing loopback only when the
 * principal runtime requires it.
 */
export function createServerListenOptions<TFetch>(args: {
  readonly port: number;
  readonly fetch: TFetch;
  readonly principalRuntime: ServerPrincipalRuntime;
}): {
  readonly port: number;
  readonly fetch: TFetch;
  readonly hostname?: string;
} {
  if (args.principalRuntime.hostname === undefined) {
    return Object.freeze({
      port: args.port,
      fetch: args.fetch,
    });
  }
  return Object.freeze({
    port: args.port,
    fetch: args.fetch,
    hostname: args.principalRuntime.hostname,
  });
}

/**
 * Idempotent best-effort close for shutdown paths that must run even when
 * earlier shutdown steps fail.
 */
export async function closeServerPrincipalRuntimeBestEffort(
  runtime: ServerPrincipalRuntime,
): Promise<void> {
  try {
    await runtime.close();
  } catch {
    // Shutdown must continue; caller may log without echoing config.
  }
}

function readPrincipalMode(
  env: NodeJS.ProcessEnv,
): typeof PRINCIPAL_MODE_LOCAL_OWNER | typeof PRINCIPAL_MODE_WORK_TOGETHER {
  const raw = env[ENV_PRINCIPAL_MODE];
  if (raw === undefined) {
    return PRINCIPAL_MODE_LOCAL_OWNER;
  }
  if (raw === PRINCIPAL_MODE_LOCAL_OWNER) {
    return PRINCIPAL_MODE_LOCAL_OWNER;
  }
  if (raw === PRINCIPAL_MODE_WORK_TOGETHER) {
    return PRINCIPAL_MODE_WORK_TOGETHER;
  }
  rejectServerPrincipalConfiguration();
}

function readWorkTogetherEnvConfig(
  env: NodeJS.ProcessEnv,
): WorkTogetherEnvConfig {
  return {
    issuer: readRequiredNonEmptyEnv(env, ENV_ISSUER),
    cellId: readRequiredNonEmptyEnv(env, ENV_CELL_ID),
    workspaceId: readRequiredNonEmptyEnv(env, ENV_WORKSPACE_ID),
    membershipDatabaseUrl: readRequiredNonEmptyEnv(
      env,
      ENV_MEMBERSHIP_DATABASE_URL,
    ),
    verificationKeysJson: readRequiredNonEmptyEnv(env, ENV_VERIFICATION_KEYS),
    replayMaxEntries: readOptionalReplayMaxEntries(env),
  };
}

function readRequiredNonEmptyEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length < 1 || value.trim() !== value) {
    rejectServerPrincipalConfiguration();
  }
  return value;
}

function readOptionalReplayMaxEntries(
  env: NodeJS.ProcessEnv,
): number | undefined {
  const raw = env[ENV_REPLAY_MAX_ENTRIES];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || !REPLAY_MAX_ENTRIES_PATTERN.test(raw)) {
    rejectServerPrincipalConfiguration();
  }
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_REPLAY_MAX_ENTRIES ||
    parsed > MAX_REPLAY_MAX_ENTRIES
  ) {
    rejectServerPrincipalConfiguration();
  }
  return parsed;
}

async function importVerificationKeys(
  rawJson: string,
): Promise<ReadonlyMap<string, WorkTogetherPrincipalVerificationKey>> {
  const tree = parseStrictObjectTree(rawJson);
  assertNoDuplicatePropertyNames(tree);

  const entries = new Map<string, string>();
  for (const { name, valueNode } of objectProperties(tree)) {
    if (!KID_PATTERN.test(name)) {
      rejectServerPrincipalConfiguration();
    }
    if (entries.has(name)) {
      rejectServerPrincipalConfiguration();
    }
    if (valueNode.type !== "string") {
      rejectServerPrincipalConfiguration();
    }
    const x = getNodeValue(valueNode);
    if (typeof x !== "string") {
      rejectServerPrincipalConfiguration();
    }
    assertCanonicalEd25519PublicX(x);
    entries.set(name, x);
  }

  if (entries.size < 1 || entries.size > 2) {
    rejectServerPrincipalConfiguration();
  }

  const imported = new Map<string, WorkTogetherPrincipalVerificationKey>();
  for (const [kid, x] of entries) {
    const jwk: JWK = {
      kty: "OKP",
      crv: "Ed25519",
      x,
    };
    let key: CryptoKey | Uint8Array;
    try {
      key = await importJWK(jwk, "EdDSA");
    } catch {
      rejectServerPrincipalConfiguration();
    }
    if (!(typeof CryptoKey !== "undefined" && key instanceof CryptoKey)) {
      rejectServerPrincipalConfiguration();
    }
    imported.set(kid, key);
  }
  return imported;
}

function assertCanonicalEd25519PublicX(value: string): void {
  if (!BASE64URL_PATTERN.test(value)) {
    rejectServerPrincipalConfiguration();
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch {
    rejectServerPrincipalConfiguration();
  }
  if (
    bytes.byteLength !== ED25519_PUBLIC_X_BYTES ||
    bytes.toString("base64url") !== value
  ) {
    rejectServerPrincipalConfiguration();
  }
}

function parseStrictObjectTree(text: string): Node {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });
  if (
    errors.length > 0 ||
    tree === undefined ||
    tree.type !== "object" ||
    tree.offset !== 0 ||
    tree.length !== text.length
  ) {
    rejectServerPrincipalConfiguration();
  }
  return tree;
}

function assertNoDuplicatePropertyNames(node: Node): void {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      if (
        property.type !== "property" ||
        property.children === undefined ||
        property.children.length < 2
      ) {
        rejectServerPrincipalConfiguration();
      }
      const nameNode = property.children[0]!;
      if (nameNode.type !== "string" || typeof nameNode.value !== "string") {
        rejectServerPrincipalConfiguration();
      }
      if (seen.has(nameNode.value)) {
        rejectServerPrincipalConfiguration();
      }
      seen.add(nameNode.value);
      assertNoDuplicatePropertyNames(property.children[1]!);
    }
    return;
  }
  if (node.type === "array") {
    for (const child of node.children ?? []) {
      assertNoDuplicatePropertyNames(child);
    }
  }
}

function objectProperties(
  tree: Node,
): readonly { readonly name: string; readonly valueNode: Node }[] {
  const properties: { name: string; valueNode: Node }[] = [];
  for (const property of tree.children ?? []) {
    if (
      property.type !== "property" ||
      property.children === undefined ||
      property.children.length < 2
    ) {
      rejectServerPrincipalConfiguration();
    }
    const nameNode = property.children[0]!;
    const valueNode = property.children[1]!;
    if (nameNode.type !== "string" || typeof nameNode.value !== "string") {
      rejectServerPrincipalConfiguration();
    }
    properties.push({ name: nameNode.value, valueNode });
  }
  return properties;
}

function createDefaultPgPool(
  config: CreateServerPrincipalPgPoolConfig,
): ServerPrincipalPgPool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max,
  });
}

/**
 * Adapt `pg` clients to the membership adapter's readonly-values structural
 * pool without weakening that adapter's types.
 */
function adaptPgPool(
  pool: ServerPrincipalPgPool,
): WorkTogetherMembershipSqlPool {
  return {
    async connect(): Promise<WorkTogetherMembershipSqlClient> {
      const client = await pool.connect();
      return {
        async query(queryText, values) {
          const copied = values === undefined ? undefined : Array.from(values);
          const result = await client.query(queryText, copied);
          return { rows: result.rows };
        },
        release() {
          client.release();
        },
      };
    },
  };
}

async function endPoolBestEffort(pool: ServerPrincipalPgPool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // Avoid masking the original configuration failure.
  }
}

function freezeRuntime(
  runtime: ServerPrincipalRuntime,
): ServerPrincipalRuntime {
  return Object.freeze(runtime);
}
