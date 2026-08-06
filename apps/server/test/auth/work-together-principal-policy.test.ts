import { createConnection, migrate, type DbConnection } from "@bb/db";
import {
  WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER,
  WORK_TOGETHER_PRINCIPAL_JWT_ALG,
  WORK_TOGETHER_PRINCIPAL_JWT_TYP,
} from "@bb/server-contract";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  type KeyObject,
} from "node:crypto";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { getClientWebsocketReauthorizePair } from "../../src/auth/client-websocket-authorization.js";
import { issueRoomDistributionAuthorization } from "../../src/auth/room-distribution-authorization.js";
import { issueRoomProvisioningAuthorization } from "../../src/auth/room-provisioning-authorization.js";
import { getTerminalWebsocketReauthorizePair } from "../../src/auth/terminal-websocket-authorization.js";
import { createWorkTogetherMembershipMemoryFake } from "../../src/auth/work-together-membership-memory.js";
import { WorkTogetherMembershipLookupError } from "../../src/auth/work-together-membership.js";
import { WorkTogetherPrincipalAssertionError } from "../../src/auth/work-together-principal-assertion-error.js";
import { createWorkTogetherPrincipalPolicy } from "../../src/auth/work-together-principal-policy.js";
import {
  createSqlitePrincipalAssertionReplayGuard,
  type PrincipalAssertionReplayConsumeResult,
  type PrincipalAssertionReplayGuard,
} from "../../src/auth/work-together-principal-replay-guard.js";

const ISSUER = "https://work-together.example/issuer";
const CELL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WORKSPACE_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const OTHER_CELL = "cccccccc-dddd-4eee-8fff-000000000000";
const OTHER_WORKSPACE = "dddddddd-eeee-4fff-8000-111111111111";
const SUBJECT = "user_2abcDEF0123456789";
const DISPLAY_NAME = "Ada Lovelace";
const KID = "wt-cell-1";
const OTHER_KID = "wt-cell-2";
const JTI_A = "11111111-1111-4111-8111-111111111111";
const JTI_B = "22222222-2222-4222-8222-222222222222";
const LARGE_REVISION = "9007199254740993";
const BASE_TIME_MS = 1_700_000_000_000;
const BASE_TIME_SEC = Math.floor(BASE_TIME_MS / 1000);

type ClaimOverrides = Record<string, unknown>;

type TestKeys = {
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  readonly nodePrivateKey: KeyObject;
  readonly nodePublicKey: KeyObject;
};

let keysPromise: Promise<TestKeys> | undefined;
const openDatabases: DbConnection[] = [];

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
      key: {
        kty: jwk.kty,
        crv: jwk.crv,
        d: jwk.d,
        x: jwk.x,
      },
    });
    const nodePublicKey = createPublicKey(nodePrivateKey);
    return {
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      nodePrivateKey,
      nodePublicKey,
    };
  })();
  return keysPromise;
}

function baseClaims(overrides: ClaimOverrides = {}): Record<string, unknown> {
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

function encodeBase64Url(bytes: Uint8Array | Buffer | string): string {
  const buffer =
    typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return buffer.toString("base64url");
}

async function signClaims(
  claims: Record<string, unknown>,
  options: {
    readonly kid?: string;
    readonly headerExtra?: Record<string, unknown>;
    readonly alg?: string;
    readonly typ?: string;
    readonly privateKey?: CryptoKey | KeyObject;
  } = {},
): Promise<string> {
  const { privateKey } = await testKeys();
  const key = options.privateKey ?? privateKey;
  const header: Record<string, unknown> = {
    alg: options.alg ?? WORK_TOGETHER_PRINCIPAL_JWT_ALG,
    kid: options.kid ?? KID,
    typ: options.typ ?? WORK_TOGETHER_PRINCIPAL_JWT_TYP,
    ...options.headerExtra,
  };
  return new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader(header as { alg: string; kid: string; typ: string })
    .sign(key);
}

/** Build a compact JWS from raw JSON texts (for duplicate-key / lexical attacks). */
function signRawCompactJws(args: {
  readonly headerJson: string;
  readonly payloadJson: string;
  readonly privateKey: KeyObject;
}): string {
  const headerSegment = encodeBase64Url(args.headerJson);
  const payloadSegment = encodeBase64Url(args.payloadJson);
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = nodeSign(
    null,
    Buffer.from(signingInput, "utf8"),
    args.privateKey,
  );
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function createReplayFake(options?: {
  readonly results?: PrincipalAssertionReplayConsumeResult[];
  readonly error?: Error;
}): PrincipalAssertionReplayGuard & {
  readonly calls: Array<{
    jti: string;
    expiresAtMs: number;
    nowMs: number;
  }>;
} {
  const calls: Array<{ jti: string; expiresAtMs: number; nowMs: number }> = [];
  const results = options?.results ?? [];
  let index = 0;
  return {
    calls,
    async consume(args) {
      calls.push({ ...args });
      if (options?.error) {
        throw options.error;
      }
      const result = results[index] ?? "consumed";
      index += 1;
      return result;
    },
  };
}

function createPolicy(args: {
  readonly membership: ReturnType<
    typeof createWorkTogetherMembershipMemoryFake
  >;
  readonly replayGuard?: PrincipalAssertionReplayGuard;
  readonly verificationKeys?: Record<string, CryptoKey | KeyObject>;
  readonly nowMs?: number;
  readonly issuer?: string;
  readonly cellId?: string;
  readonly workspaceId?: string;
  readonly publicKey: CryptoKey | KeyObject;
}) {
  let clock = args.nowMs ?? BASE_TIME_MS;
  return {
    policy: createWorkTogetherPrincipalPolicy({
      issuer: args.issuer ?? ISSUER,
      cellId: args.cellId ?? CELL_ID,
      workspaceId: args.workspaceId ?? WORKSPACE_ID,
      verificationKeys: args.verificationKeys ?? { [KID]: args.publicKey },
      membershipVerifier: args.membership,
      replayGuard: args.replayGuard ?? createReplayFake(),
      now: () => clock,
    }),
    setNow(ms: number) {
      clock = ms;
    },
  };
}

function requestFrom(args: {
  readonly method?: string;
  readonly target?: string;
  readonly transport?: "http" | "websocket";
  readonly token?: string;
  readonly extraHeaders?: Record<string, string>;
}) {
  const headers = new Map<string, string>();
  if (args.token !== undefined) {
    headers.set(WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER, args.token);
  }
  for (const [name, value] of Object.entries(args.extraHeaders ?? {})) {
    headers.set(name.toLowerCase(), value);
  }
  return {
    method: args.method ?? "GET",
    target: args.target ?? "/api/v1/projects",
    transport: args.transport ?? "http",
    getHeader: (name: string) => headers.get(name.toLowerCase()),
  };
}

async function expectAssertionRejected(
  run: () => Promise<unknown>,
  distinctive: readonly string[],
): Promise<void> {
  try {
    await run();
    expect.fail("expected WorkTogetherPrincipalAssertionError");
  } catch (error) {
    expect(error).toBeInstanceOf(WorkTogetherPrincipalAssertionError);
    const message = (error as Error).message;
    expect(message).toBe("Work Together principal assertion rejected");
    for (const fragment of distinctive) {
      if (fragment.length > 0) {
        expect(message).not.toContain(fragment);
      }
    }
  }
}

describe("work-together principal policy", () => {
  it("resolves a frozen owner principal for a valid assertion", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const token = await signClaims(baseClaims());

    const session = await policy.resolve(requestFrom({ token }));
    expect(session.principal).toEqual({
      id: SUBJECT,
      kind: "human",
      displayName: DISPLAY_NAME,
    });
    expect(Object.isFrozen(session.principal)).toBe(true);
    expect(Object.isFrozen(session)).toBe(true);
    expect(() => {
      (session.principal as { displayName: string }).displayName = "x";
    }).toThrow();
    expect("membershipRevision" in session.principal).toBe(false);
    expect(session.expiresAtMs).toBe((BASE_TIME_SEC + 30) * 1000);
    expect(session.clientRealtimeScope).toBe("scoped");
    await expect(
      session.authorize(
        { name: "publicHttp.projects.get" },
        { kind: "project", id: "project-1" },
      ),
    ).resolves.toEqual({ allowed: true });
  });

  it("accepts members, bigint revisions, and canonical query targets", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: LARGE_REVISION,
    });
    const target = "/api/v1/items?limit=10&offset=0";
    const { policy } = createPolicy({ membership, publicKey });
    const token = await signClaims(
      baseClaims({
        membership_revision: LARGE_REVISION,
        request_target: target,
      }),
    );

    const session = await policy.resolve(
      requestFrom({ token, target, method: "GET" }),
    );
    expect(session.principal.kind).toBe("human");
    await expect(
      session.authorize(
        { name: "publicHttp.projects.get" },
        { kind: "project", id: "project-1" },
      ),
    ).resolves.toEqual({ allowed: true });
    await expect(
      session.authorize({ name: "any" }, { kind: "project", id: null }),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
  });

  it("rejects missing, malformed, oversize, and invalid-signature tokens", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const valid = await signClaims(baseClaims());
    const distinctive = [valid, SUBJECT, KID, "/api/v1/projects", ISSUER];

    await expectAssertionRejected(
      () => policy.resolve(requestFrom({})),
      distinctive,
    );
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: "a.b" })),
      distinctive,
    );
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: "a.b.c.d" })),
      distinctive,
    );
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: "@@@.@@@.@@@" })),
      distinctive,
    );
    await expectAssertionRejected(
      () =>
        policy.resolve(
          requestFrom({
            token: `${"a".repeat(8200)}.${"b".repeat(10)}.${"c".repeat(10)}`,
          }),
        ),
      ["a".repeat(32)],
    );

    const parts = valid.split(".");
    const signature = parts[2]!;
    const badSig = `${parts[0]}.${parts[1]}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: badSig })),
      [SUBJECT, KID],
    );

    const utf8Bomb = encodeBase64Url(Buffer.from([0xe2, 0x28, 0xa1]));
    await expectAssertionRejected(
      () =>
        policy.resolve(
          requestFrom({ token: `${utf8Bomb}.${parts[1]}.${parts[2]}` }),
        ),
      distinctive,
    );
  });

  it("rejects none/HS/RS confusion, wrong typ, unknown kid, and remote JWK headers", async () => {
    const { publicKey, nodePrivateKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const claims = baseClaims();
    const payload = JSON.stringify(claims);

    const noneToken = `${encodeBase64Url(
      JSON.stringify({
        alg: "none",
        kid: KID,
        typ: WORK_TOGETHER_PRINCIPAL_JWT_TYP,
      }),
    )}.${encodeBase64Url(payload)}.e`;
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: noneToken })),
      [SUBJECT, "none"],
    );

    const hsToken = signRawCompactJws({
      headerJson: JSON.stringify({
        alg: "HS256",
        kid: KID,
        typ: WORK_TOGETHER_PRINCIPAL_JWT_TYP,
      }),
      payloadJson: payload,
      privateKey: nodePrivateKey,
    });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: hsToken })),
      [SUBJECT, "HS256"],
    );

    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      createWorkTogetherPrincipalPolicy({
        issuer: ISSUER,
        cellId: CELL_ID,
        workspaceId: WORKSPACE_ID,
        verificationKeys: { [KID]: rsa.publicKey },
        membershipVerifier: membership,
        replayGuard: createReplayFake(),
        now: () => BASE_TIME_MS,
      }),
    ).toThrow(WorkTogetherPrincipalAssertionError);

    const wrongTyp = await signClaims(claims, { typ: "JWT" });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: wrongTyp })),
      [SUBJECT],
    );

    const unknownKid = await signClaims(claims, { kid: "missing-kid" });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: unknownKid })),
      ["missing-kid", SUBJECT],
    );

    const withJku = await signClaims(claims, {
      headerExtra: { jku: "https://evil.example/jwks" },
    });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: withJku })),
      ["evil.example", SUBJECT],
    );

    const withJwk = await signClaims(claims, {
      headerExtra: {
        jwk: {
          kty: "OKP",
          crv: "Ed25519",
          x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
      },
    });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: withJwk })),
      [SUBJECT],
    );
  });

  it("rejects unknown and duplicate header/claim keys including escaped aliases", async () => {
    const { publicKey, nodePrivateKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const claims = baseClaims();

    const unknownClaim = await signClaims({ ...claims, extra: "x" });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: unknownClaim })),
      [SUBJECT],
    );

    const duplicateClaim = signRawCompactJws({
      headerJson: JSON.stringify({
        alg: WORK_TOGETHER_PRINCIPAL_JWT_ALG,
        kid: KID,
        typ: WORK_TOGETHER_PRINCIPAL_JWT_TYP,
      }),
      payloadJson: `{"iss":${JSON.stringify(ISSUER)},"aud":${JSON.stringify(CELL_ID)},"sub":${JSON.stringify(SUBJECT)},"jti":${JSON.stringify(JTI_A)},"iat":${BASE_TIME_SEC},"nbf":${BASE_TIME_SEC},"exp":${BASE_TIME_SEC + 30},"workspace_id":${JSON.stringify(WORKSPACE_ID)},"membership_revision":"1","principal_kind":"human","display_name":${JSON.stringify(DISPLAY_NAME)},"request_method":"GET","request_target":"/api/v1/projects","transport":"http","sub":"user_other"}`,
      privateKey: nodePrivateKey,
    });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: duplicateClaim })),
      [SUBJECT, "user_other"],
    );

    const escapedAlias = signRawCompactJws({
      headerJson: `{"alg":"EdDSA","kid":"${KID}","typ":"${WORK_TOGETHER_PRINCIPAL_JWT_TYP}","\\u0061lg":"EdDSA"}`,
      payloadJson: JSON.stringify(claims),
      privateKey: nodePrivateKey,
    });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: escapedAlias })),
      [SUBJECT, KID],
    );

    const duplicateHeader = signRawCompactJws({
      headerJson: `{"alg":"EdDSA","kid":"${KID}","typ":"${WORK_TOGETHER_PRINCIPAL_JWT_TYP}","kid":"${OTHER_KID}"}`,
      payloadJson: JSON.stringify(claims),
      privateKey: nodePrivateKey,
    });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: duplicateHeader })),
      [OTHER_KID, SUBJECT],
    );
  });

  it("rejects wrong issuer/audience/workspace/method/target/transport and raw identity headers", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });

    const cases: Array<{
      claims?: ClaimOverrides;
      method?: string;
      target?: string;
      transport?: "http" | "websocket";
      extraHeaders?: Record<string, string>;
      distinctive: string[];
    }> = [
      {
        claims: { iss: "https://evil.example" },
        distinctive: ["evil.example", SUBJECT],
      },
      {
        claims: { aud: OTHER_CELL },
        distinctive: [OTHER_CELL, SUBJECT],
      },
      {
        claims: { aud: [CELL_ID] },
        distinctive: [SUBJECT],
      },
      {
        claims: { workspace_id: OTHER_WORKSPACE },
        distinctive: [OTHER_WORKSPACE, SUBJECT],
      },
      {
        claims: { request_method: "POST" },
        distinctive: [SUBJECT],
      },
      {
        claims: { request_target: "/api/v1/other" },
        target: "/api/v1/projects",
        distinctive: ["/api/v1/other", SUBJECT],
      },
      {
        claims: { transport: "websocket" },
        transport: "http",
        distinctive: [SUBJECT],
      },
      {
        extraHeaders: { authorization: "Bearer x" },
        distinctive: [SUBJECT, "Bearer"],
      },
      {
        extraHeaders: { "x-user-id": SUBJECT },
        distinctive: [SUBJECT],
      },
      {
        extraHeaders: { "x-bb-principal": SUBJECT },
        distinctive: [SUBJECT],
      },
    ];

    for (const testCase of cases) {
      const token = await signClaims(baseClaims(testCase.claims ?? {}));
      await expectAssertionRejected(
        () =>
          policy.resolve(
            requestFrom({
              token,
              method: testCase.method,
              target: testCase.target,
              transport: testCase.transport,
              extraHeaders: testCase.extraHeaders,
            }),
          ),
        testCase.distinctive,
      );
    }
  });

  it("rejects invalid subject/jti/kind/display/revision and non-canonical integer forms", async () => {
    const { publicKey, nodePrivateKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });

    for (const overrides of [
      { sub: "user" },
      { sub: "USER_abc" },
      { jti: "NOT-A-UUID" },
      { jti: "11111111-1111-4111-8111-11111111111A" },
      { principal_kind: "agent" },
      { display_name: " Ada" },
      { display_name: "Ada\n" },
      { display_name: "" },
      { display_name: "Ada\ud800" },
      { membership_revision: "0" },
      { membership_revision: "01" },
      { membership_revision: "9223372036854775808" },
    ] as ClaimOverrides[]) {
      const token = await signClaims(baseClaims(overrides));
      await expectAssertionRejected(
        () => policy.resolve(requestFrom({ token })),
        [SUBJECT, String(overrides.sub ?? ""), String(overrides.jti ?? "")],
      );
    }

    for (const badIat of ["01", "1e2", "1.0", "-1", "+1"]) {
      const payload = JSON.stringify(baseClaims()).replace(
        `"iat":${BASE_TIME_SEC}`,
        `"iat":${badIat}`,
      );
      const token = signRawCompactJws({
        headerJson: JSON.stringify({
          alg: WORK_TOGETHER_PRINCIPAL_JWT_ALG,
          kid: KID,
          typ: WORK_TOGETHER_PRINCIPAL_JWT_TYP,
        }),
        payloadJson: payload,
        privateKey: nodePrivateKey,
      });
      await expectAssertionRejected(
        () => policy.resolve(requestFrom({ token })),
        [SUBJECT, badIat],
      );
    }
  });

  it("rejects future, expired, lifetime, and nbf mismatch assertions", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy, setNow } = createPolicy({ membership, publicKey });

    const future = await signClaims(
      baseClaims({
        iat: BASE_TIME_SEC + 10,
        nbf: BASE_TIME_SEC + 10,
        exp: BASE_TIME_SEC + 40,
      }),
    );
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: future })),
      [SUBJECT],
    );

    const expired = await signClaims(
      baseClaims({
        iat: BASE_TIME_SEC - 120,
        nbf: BASE_TIME_SEC - 120,
        exp: BASE_TIME_SEC - 60,
      }),
    );
    setNow(BASE_TIME_MS);
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: expired })),
      [SUBJECT],
    );

    const tooLong = await signClaims(
      baseClaims({
        iat: BASE_TIME_SEC,
        nbf: BASE_TIME_SEC,
        exp: BASE_TIME_SEC + 61,
      }),
    );
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: tooLong })),
      [SUBJECT],
    );

    const nbfMismatch = await signClaims(
      baseClaims({
        iat: BASE_TIME_SEC,
        nbf: BASE_TIME_SEC + 1,
        exp: BASE_TIME_SEC + 30,
      }),
    );
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: nbfMismatch })),
      [SUBJECT],
    );
  });

  it("fails closed on removed membership, membership errors, and stale revisions", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    const { policy } = createPolicy({ membership, publicKey });
    const token = await signClaims(baseClaims());

    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token })),
      [SUBJECT],
    );

    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "2",
    });
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token })),
      [SUBJECT],
    );

    const erroring = createWorkTogetherMembershipMemoryFake();
    erroring.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    erroring.currentMembership = async () => {
      throw new WorkTogetherMembershipLookupError();
    };
    const { policy: errorPolicy } = createPolicy({
      membership: erroring,
      publicKey,
    });
    await expectAssertionRejected(
      () => errorPolicy.resolve(requestFrom({ token })),
      [SUBJECT],
    );

    erroring.currentMembership = async () =>
      ({ role: "administrator", membershipRevision: "1" }) as never;
    await expectAssertionRejected(
      () => errorPolicy.resolve(requestFrom({ token })),
      [SUBJECT, "administrator"],
    );
  });

  it("authorize accepts registry-issued client-WS pairs for owner and member after recheck", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const token = await signClaims(baseClaims());
    const session = await policy.resolve(requestFrom({ token }));
    const reauthorize = getClientWebsocketReauthorizePair();
    await expect(
      session.authorize(reauthorize.action, reauthorize.resource),
    ).resolves.toEqual({ allowed: true });
    const terminalReauthorize = getTerminalWebsocketReauthorizePair();
    await expect(
      session.authorize(
        terminalReauthorize.action,
        terminalReauthorize.resource,
      ),
    ).resolves.toEqual({ allowed: true });
    const roomEvents = issueRoomDistributionAuthorization({
      bindingId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
      operation: "events",
    });
    await expect(
      session.authorize(roomEvents.action, roomEvents.resource),
    ).resolves.toEqual({ allowed: true });

    // Structural forgeries of the reauthorize pair are denied.
    await expect(
      session.authorize(
        { name: reauthorize.action.name },
        { kind: reauthorize.resource.kind, id: reauthorize.resource.id },
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      session.authorize({ ...roomEvents.action }, { ...roomEvents.resource }),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      session.authorize(
        { name: terminalReauthorize.action.name },
        {
          kind: terminalReauthorize.resource.kind,
          id: terminalReauthorize.resource.id,
        },
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });

    membership.removeMembership({ cellId: CELL_ID, subject: SUBJECT });
    await expect(
      session.authorize(reauthorize.action, reauthorize.resource),
    ).resolves.toEqual({ allowed: false, reason: "unauthenticated" });
  });

  it("allows registry-issued Room provisioning only for a current owner", async () => {
    const { publicKey } = await testKeys();
    const pair = issueRoomProvisioningAuthorization(
      "99999999-aaaa-4bbb-8ccc-dddddddddddd",
    );

    const member = createWorkTogetherMembershipMemoryFake();
    member.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "1",
    });
    const memberSession = await createPolicy({
      membership: member,
      publicKey,
    }).policy.resolve(requestFrom({ token: await signClaims(baseClaims()) }));
    await expect(
      memberSession.authorize(pair.action, pair.resource),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });

    const owner = createWorkTogetherMembershipMemoryFake();
    owner.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const ownerSession = await createPolicy({
      membership: owner,
      publicKey,
    }).policy.resolve(
      requestFrom({
        token: await signClaims(baseClaims({ jti: JTI_B })),
      }),
    );
    await expect(
      ownerSession.authorize(pair.action, pair.resource),
    ).resolves.toEqual({ allowed: true });

    await expect(
      ownerSession.authorize({ ...pair.action }, { ...pair.resource }),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
  });

  it("authorize rechecks membership and denies after removal or revision change", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const token = await signClaims(baseClaims());
    const session = await policy.resolve(requestFrom({ token }));

    membership.removeMembership({ cellId: CELL_ID, subject: SUBJECT });
    await expect(
      session.authorize({ name: "x" }, { kind: "y", id: null }),
    ).resolves.toEqual({ allowed: false, reason: "unauthenticated" });

    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const session2 = await policy.resolve(
      requestFrom({ token: await signClaims(baseClaims({ jti: JTI_B })) }),
    );
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "9",
    });
    await expect(
      session2.authorize({ name: "x" }, { kind: "y", id: null }),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
  });

  it("enforces exact-jti replay for mutations and websocket, allows GET/http replay", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });

    const getReplay = createReplayFake();
    const { policy: getPolicy } = createPolicy({
      membership,
      publicKey,
      replayGuard: getReplay,
    });
    const getToken = await signClaims(baseClaims({ jti: JTI_A }));
    await getPolicy.resolve(requestFrom({ token: getToken, method: "GET" }));
    await getPolicy.resolve(requestFrom({ token: getToken, method: "GET" }));
    expect(getReplay.calls).toHaveLength(0);

    const mutationReplay = createReplayFake({
      results: ["consumed", "replayed"],
    });
    const { policy: postPolicy } = createPolicy({
      membership,
      publicKey,
      replayGuard: mutationReplay,
    });
    const postToken = await signClaims(
      baseClaims({
        jti: JTI_B,
        request_method: "POST",
        request_target: "/api/v1/projects",
      }),
    );
    await postPolicy.resolve(requestFrom({ token: postToken, method: "POST" }));
    await expectAssertionRejected(
      () =>
        postPolicy.resolve(requestFrom({ token: postToken, method: "POST" })),
      [SUBJECT, JTI_B],
    );
    expect(mutationReplay.calls).toHaveLength(2);
    expect(mutationReplay.calls[0]?.expiresAtMs).toBe(
      (BASE_TIME_SEC + 30 + 5) * 1000,
    );

    const wsReplay = createReplayFake({ results: ["consumed", "replayed"] });
    const { policy: wsPolicy } = createPolicy({
      membership,
      publicKey,
      replayGuard: wsReplay,
    });
    const wsToken = await signClaims(
      baseClaims({
        jti: "33333333-3333-4333-8333-333333333333",
        transport: "websocket",
        request_method: "GET",
      }),
    );
    await wsPolicy.resolve(
      requestFrom({
        token: wsToken,
        method: "GET",
        transport: "websocket",
      }),
    );
    await expectAssertionRejected(
      () =>
        wsPolicy.resolve(
          requestFrom({
            token: wsToken,
            method: "GET",
            transport: "websocket",
          }),
        ),
      [SUBJECT],
    );

    const capacityReplay = createReplayFake({
      results: ["capacity_exhausted"],
    });
    const { policy: capacityPolicy } = createPolicy({
      membership,
      publicKey,
      replayGuard: capacityReplay,
    });
    await expectAssertionRejected(
      () =>
        capacityPolicy.resolve(
          requestFrom({ token: postToken, method: "POST" }),
        ),
      [SUBJECT],
    );

    const errorReplay = createReplayFake({
      error: new Error("db blew up with jti details"),
    });
    const { policy: errorPolicy } = createPolicy({
      membership,
      publicKey,
      replayGuard: errorReplay,
    });
    await expectAssertionRejected(
      () =>
        errorPolicy.resolve(requestFrom({ token: postToken, method: "POST" })),
      [SUBJECT, "db blew up", JTI_B],
    );
  });

  it("rejects repeated-comma assertion header values", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const { policy } = createPolicy({ membership, publicKey });
    const token = await signClaims(baseClaims());
    await expectAssertionRejected(
      () => policy.resolve(requestFrom({ token: `${token},${token}` })),
      [SUBJECT],
    );
  });
});

describe("sqlite principal assertion replay guard", () => {
  function setupDb(): DbConnection {
    const db = createConnection(":memory:");
    migrate(db);
    openDatabases.push(db);
    return db;
  }

  it("persists and rejects replayed jtis through the DB ledger", async () => {
    const db = setupDb();
    const guard = createSqlitePrincipalAssertionReplayGuard({
      db,
      maxEntries: 10,
    });

    await expect(
      guard.consume({
        jti: JTI_A,
        nowMs: 1_000,
        expiresAtMs: 2_000,
      }),
    ).resolves.toBe("consumed");
    await expect(
      guard.consume({
        jti: JTI_A,
        nowMs: 1_100,
        expiresAtMs: 2_100,
      }),
    ).resolves.toBe("replayed");
    await expect(
      guard.consume({
        jti: JTI_B,
        nowMs: 1_200,
        expiresAtMs: 2_200,
      }),
    ).resolves.toBe("consumed");
  });

  it("returns capacity_exhausted without accepting new jtis when full", async () => {
    const db = setupDb();
    const guard = createSqlitePrincipalAssertionReplayGuard({
      db,
      maxEntries: 1,
    });
    await expect(
      guard.consume({
        jti: JTI_A,
        nowMs: 1_000,
        expiresAtMs: 2_000,
      }),
    ).resolves.toBe("consumed");
    await expect(
      guard.consume({
        jti: JTI_B,
        nowMs: 1_100,
        expiresAtMs: 2_100,
      }),
    ).resolves.toBe("capacity_exhausted");
  });

  it("rejects invalid maxEntries at construction with a sanitized error", () => {
    const db = setupDb();
    expect(() =>
      createSqlitePrincipalAssertionReplayGuard({ db, maxEntries: 0 }),
    ).toThrow(WorkTogetherPrincipalAssertionError);
    expect(() =>
      createSqlitePrincipalAssertionReplayGuard({ db, maxEntries: 100_001 }),
    ).toThrow(WorkTogetherPrincipalAssertionError);
    expect(() =>
      createSqlitePrincipalAssertionReplayGuard(null as never),
    ).toThrow(WorkTogetherPrincipalAssertionError);
  });
});

describe("work-together principal policy construction", () => {
  it("sanitizes malformed factory inputs", () => {
    expect(() => createWorkTogetherPrincipalPolicy(null as never)).toThrow(
      WorkTogetherPrincipalAssertionError,
    );
  });

  it("accepts Node KeyObject verification keys and rejects private keys", async () => {
    const { nodePublicKey, nodePrivateKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });
    const policy = createWorkTogetherPrincipalPolicy({
      issuer: ISSUER,
      cellId: CELL_ID,
      workspaceId: WORKSPACE_ID,
      verificationKeys: { [KID]: nodePublicKey },
      membershipVerifier: membership,
      replayGuard: createReplayFake(),
      now: () => BASE_TIME_MS,
    });
    const token = await signClaims(baseClaims());
    await expect(policy.resolve(requestFrom({ token }))).resolves.toMatchObject(
      {
        principal: { id: SUBJECT },
      },
    );

    expect(() =>
      createWorkTogetherPrincipalPolicy({
        issuer: ISSUER,
        cellId: CELL_ID,
        workspaceId: WORKSPACE_ID,
        verificationKeys: { [KID]: nodePrivateKey },
        membershipVerifier: membership,
        replayGuard: createReplayFake(),
        now: () => BASE_TIME_MS,
      }),
    ).toThrow(WorkTogetherPrincipalAssertionError);
  });

  it("rejects empty issuer and non-canonical cell/workspace ids", async () => {
    const { publicKey } = await testKeys();
    const membership = createWorkTogetherMembershipMemoryFake();
    const replayGuard = createReplayFake();
    expect(() =>
      createWorkTogetherPrincipalPolicy({
        issuer: "",
        cellId: CELL_ID,
        workspaceId: WORKSPACE_ID,
        verificationKeys: { [KID]: publicKey },
        membershipVerifier: membership,
        replayGuard,
        now: () => BASE_TIME_MS,
      }),
    ).toThrow(WorkTogetherPrincipalAssertionError);
    expect(() =>
      createWorkTogetherPrincipalPolicy({
        issuer: ISSUER,
        cellId: "NOT-A-UUID",
        workspaceId: WORKSPACE_ID,
        verificationKeys: { [KID]: publicKey },
        membershipVerifier: membership,
        replayGuard,
        now: () => BASE_TIME_MS,
      }),
    ).toThrow(WorkTogetherPrincipalAssertionError);
  });
});
