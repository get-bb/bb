import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OAUTH_ACCESS_TOKEN_TTL_MS,
  OAUTH_CODE_TTL_MS,
  OAUTH_MAX_GRANTS_PER_CLIENT,
  OAUTH_REFRESH_REUSE_GRACE_MS,
  OAUTH_REVOKED_GRANT_RETENTION_MS,
  OAUTH_REFRESH_TOKEN_TTL_MS,
  auditLog,
  oauthCode,
  oauthGrant,
  oauthRefreshToken,
  schema,
  server,
  sha256Hex,
  user,
  verifyMcpAccessToken,
} from "@bb/connect-db";
import {
  connectDbMigrationFiles,
  readConnectDbMigration,
} from "@bb/connect-db/testing";
import {
  type OAuthEnv,
  completeOAuthAuthorization,
  fetchOAuthClientMetadata,
  handleOAuthRevokeRequest,
  handleOAuthTokenRequest,
  listOAuthGrantsForCredential,
  listOAuthGrantsForUser,
  matchOAuthRedirectUri,
  oauthAuthorizationServerMetadata,
  prepareOAuthAuthorization,
  revokeOAuthGrantForCredential,
  revokeOAuthGrantForUser,
} from "./oauth.js";

const T0 = Date.UTC(2026, 9, 11, 12);
const ENV: OAuthEnv = {
  APP_URL: "https://getbb.app/",
  BASE_DOMAIN: "getbb.app",
  BETTER_AUTH_SECRET: "test-secret",
  NEXT_BASE_DOMAIN: "next.getbb.app",
};
const CLIENT_ID = "https://claude.example/oauth/client.json";
const REDIRECT_URI = "https://claude.example/callback?tenant=1";
const RESOURCE = "https://alice.getbb.app/mcp";
const NEXT_RESOURCE = "https://alice.next.getbb.app/mcp";
const VERIFIER = "v".repeat(64);
const JSON_HEADERS = { "content-type": "application/json" };

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let now: number;
let challenge: string;

function clientDocument(over: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    client_name: "Claude",
    redirect_uris: [REDIRECT_URI, "http://127.0.0.1/cb"],
    token_endpoint_auth_method: "none",
    ...over,
  };
}

function fetchReturning(
  respond: () => Response,
  calls: { url: string; init: RequestInit | undefined }[] = [],
): typeof fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
}

function documentFetch(over: Record<string, unknown> = {}): typeof fetch {
  return fetchReturning(() =>
    Response.json(clientDocument(over), { headers: JSON_HEADERS }),
  );
}

function deps(over: Record<string, unknown> = {}) {
  return { fetch: documentFetch(over), now: () => now };
}

function authorizeParams(over: Record<string, string | null> = {}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    scope: "bb",
    state: "st-1",
  });
  for (const [name, value] of Object.entries(over)) {
    if (value === null) params.delete(name);
    else params.set(name, value);
  }
  return params;
}

function seedUser(id: string): void {
  const at = new Date(T0);
  db.insert(user)
    .values({
      id,
      name: `Name ${id}`,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: at,
      updatedAt: at,
    })
    .run();
}

function seedServer(
  id: string,
  userId: string,
  subdomain: string,
  credentialHash: string | null = null,
): void {
  db.insert(server)
    .values({
      id,
      userId,
      name: `${subdomain}-box`,
      subdomain,
      credentialHash,
      createdAt: new Date(T0),
    })
    .run();
}

function redirectParams(result: { kind: string; url?: string }) {
  expect(result.kind).toBe("redirect");
  return new URL(result.url ?? "").searchParams;
}

async function authorize(
  over: Record<string, string | null> = {},
): Promise<string> {
  const result = await completeOAuthAuthorization(
    ENV,
    db,
    "alice",
    authorizeParams(over),
    { approved: true },
    deps(),
  );
  const code = redirectParams(result).get("code");
  if (!code) throw new Error("no code issued");
  return code;
}

function tokenRequest(
  body: Record<string, string>,
  contentType = "application/x-www-form-urlencoded",
): Promise<Response> {
  return handleOAuthTokenRequest(
    ENV,
    db,
    new Request("https://getbb.app/oauth/token", {
      method: "POST",
      headers: { "content-type": contentType },
      body: new URLSearchParams(body).toString(),
    }),
    { now: () => now },
  );
}

function codeBody(code: string, over: Record<string, string> = {}) {
  return {
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
    ...over,
  };
}

interface TokenBody {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function tokens(response: Response): Promise<TokenBody> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}

async function expectTokenError(
  response: Response,
  error: string,
): Promise<void> {
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ error });
}

async function exchange(): Promise<TokenBody> {
  return tokens(await tokenRequest(codeBody(await authorize())));
}

function refresh(
  refreshToken: string,
  clientId = CLIENT_ID,
  over: Record<string, string> = {},
) {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    ...over,
  });
}

function liveRefreshRowCount(): number {
  return db
    .select()
    .from(oauthRefreshToken)
    .all()
    .filter((row) => row.rotatedAt === null).length;
}

function revokeReasons(): string[] {
  return db
    .select()
    .from(auditLog)
    .all()
    .filter((row) => row.action === "mcp.oauth.revoke")
    .map((row) => JSON.parse(row.detail ?? "{}").reason);
}

function revokeRequest(token: string): Promise<Response> {
  return handleOAuthRevokeRequest(
    ENV,
    db,
    new Request("https://getbb.app/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    }),
    { now: () => now },
  );
}

function grantRows() {
  return db.select().from(oauthGrant).all();
}

function auditActions(): string[] {
  return db
    .select({ action: auditLog.action })
    .from(auditLog)
    .all()
    .map((row) => row.action);
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of connectDbMigrationFiles()) {
    sqlite.exec(readConnectDbMigration(file));
  }
  db = drizzle(sqlite, { schema });
  now = T0;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(VERIFIER),
  );
  challenge = Buffer.from(digest).toString("base64url");
  seedUser("alice");
  seedUser("bob");
  seedServer("srv-alice", "alice", "alice", await sha256Hex("bbcred_alice"));
  seedServer("srv-alice-2", "alice", "alice2", await sha256Hex("bbcred_two"));
  seedServer("srv-bob", "bob", "bob");
});

afterEach(() => {
  sqlite.close();
});

describe("authorization server metadata", () => {
  it("describes a CIMD-only public-client server under the normalized issuer", () => {
    expect(oauthAuthorizationServerMetadata(ENV)).toEqual({
      issuer: "https://getbb.app",
      authorization_endpoint: "https://getbb.app/oauth/authorize",
      token_endpoint: "https://getbb.app/oauth/token",
      revocation_endpoint: "https://getbb.app/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["bb"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe("client metadata documents", () => {
  const load = (fetchImpl: typeof fetch, clientId = CLIENT_ID) =>
    fetchOAuthClientMetadata(clientId, { allowHttp: false, fetch: fetchImpl });

  it("fetches without following redirects and normalizes the name", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const result = await load(
      fetchReturning(
        () =>
          Response.json(
            clientDocument({ client_name: `  ${"n".repeat(90)}` }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
            },
          ),
        calls,
      ),
    );
    expect(result).toEqual({
      ok: true,
      client: {
        clientId: CLIENT_ID,
        clientName: "n".repeat(80),
        redirectUris: [REDIRECT_URI, "http://127.0.0.1/cb"],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(CLIENT_ID);
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a redirect response", async () => {
    const result = await load(
      fetchReturning(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.example/client.json" },
          }),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a document over 5 KB even when it streams without a length", async () => {
    const big = JSON.stringify(clientDocument({ padding: "x".repeat(6000) }));
    const result = await load(
      fetchReturning(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(big));
                controller.close();
              },
            }),
            { headers: JSON_HEADERS },
          ),
      ),
    );
    expect(result).toEqual({
      ok: false,
      message: "client metadata document is too large",
    });
  });

  it.each([
    ["a mismatched client_id", { client_id: `${CLIENT_ID}/` }],
    [
      "a confidential auth method",
      { token_endpoint_auth_method: "client_secret_basic" },
    ],
    ["an empty client_name", { client_name: "   " }],
    ["empty redirect_uris", { redirect_uris: [] }],
    ["non-string redirect_uris", { redirect_uris: [REDIRECT_URI, 7] }],
  ])("rejects %s", async (_label, over) => {
    expect((await load(documentFetch(over))).ok).toBe(false);
  });

  it("rejects a non-JSON content type", async () => {
    const result = await load(
      fetchReturning(
        () =>
          new Response(JSON.stringify(clientDocument()), {
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it.each([
    "http://claude.example/oauth/client.json",
    "http://localhost:3000/client.json",
    "https://203.0.113.9/client.json",
    "https://[2001:db8::1]/client.json",
    "https://user:pw@claude.example/client.json",
    "https://claude.example/client.json#frag",
    "https://claude.example",
    "not a url",
  ])("never fetches the disallowed client_id %s", async (clientId) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const result = await load(
      fetchReturning(() => Response.json({}), calls),
      clientId,
    );
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("allows a loopback http client_id only in local dev", async () => {
    const clientId = "http://localhost:3000/client.json";
    const result = await fetchOAuthClientMetadata(clientId, {
      allowHttp: true,
      fetch: documentFetch({ client_id: clientId }),
    });
    expect(result.ok).toBe(true);
    const remote = await fetchOAuthClientMetadata(
      "http://claude.example/client.json",
      { allowHttp: true, fetch: documentFetch() },
    );
    expect(remote.ok).toBe(false);
  });

  it("treats a thrown fetch as a failure", async () => {
    const result = await load(async () => {
      throw new Error("timeout");
    });
    expect(result.ok).toBe(false);
  });
});

describe("redirect URI matching", () => {
  it("requires an exact match for https redirect URIs", () => {
    const registered = ["https://app.example/cb"];
    expect(matchOAuthRedirectUri("https://app.example/cb", registered)).toBe(
      true,
    );
    expect(matchOAuthRedirectUri("https://app.example/cb/", registered)).toBe(
      false,
    );
    expect(
      matchOAuthRedirectUri("https://app.example/cb?x=1", registered),
    ).toBe(false);
    expect(
      matchOAuthRedirectUri("https://app.example:8443/cb", registered),
    ).toBe(false);
    expect(
      matchOAuthRedirectUri("https://app.example.evil.test/cb", registered),
    ).toBe(false);
  });

  it("ignores only the port for loopback redirect URIs", () => {
    const registered = ["http://127.0.0.1/cb", "http://[::1]:1/cb"];
    expect(matchOAuthRedirectUri("http://127.0.0.1:51234/cb", registered)).toBe(
      true,
    );
    expect(matchOAuthRedirectUri("http://[::1]:9/cb", registered)).toBe(true);
    expect(
      matchOAuthRedirectUri("http://127.0.0.1:51234/other", registered),
    ).toBe(false);
    expect(matchOAuthRedirectUri("http://localhost:51234/cb", registered)).toBe(
      false,
    );
  });

  it("rejects non-https, non-loopback redirect URIs even when registered", () => {
    expect(
      matchOAuthRedirectUri("http://app.example/cb", ["http://app.example/cb"]),
    ).toBe(false);
    expect(matchOAuthRedirectUri("myapp://cb", ["myapp://cb"])).toBe(false);
    expect(
      matchOAuthRedirectUri("https://app.example/cb#f", [
        "https://app.example/cb#f",
      ]),
    ).toBe(false);
  });
});

describe("authorization requests", () => {
  it("shows consent for a valid request", async () => {
    const result = await prepareOAuthAuthorization(
      ENV,
      db,
      "alice",
      authorizeParams({ redirect_uri: "http://127.0.0.1:4455/cb" }),
      deps(),
    );
    expect(result).toEqual({
      kind: "consent",
      consent: {
        clientName: "Claude",
        clientIdHost: "claude.example",
        redirectHost: "127.0.0.1:4455",
        loopbackRedirect: true,
        serverHandle: "alice",
        serverName: "alice-box",
      },
    });
  });

  it("shows an error page instead of redirecting to an unregistered URI", async () => {
    for (const run of [
      () =>
        prepareOAuthAuthorization(
          ENV,
          db,
          "alice",
          authorizeParams({ redirect_uri: "https://evil.example/cb" }),
          deps(),
        ),
      () =>
        completeOAuthAuthorization(
          ENV,
          db,
          "alice",
          authorizeParams({ redirect_uri: "https://evil.example/cb" }),
          { approved: true },
          deps(),
        ),
      () =>
        prepareOAuthAuthorization(
          ENV,
          db,
          "alice",
          authorizeParams({ redirect_uri: null }),
          deps(),
        ),
      () =>
        prepareOAuthAuthorization(ENV, db, "alice", authorizeParams(), {
          fetch: fetchReturning(() => new Response("nope", { status: 404 })),
        }),
    ]) {
      expect((await run()).kind).toBe("error-page");
    }
    expect(db.select().from(oauthCode).all()).toHaveLength(0);
  });

  it.each([
    ["unsupported_response_type", { response_type: "token" }],
    ["invalid_request", { code_challenge: null }],
    ["invalid_request", { code_challenge_method: "plain" }],
    ["invalid_target", { resource: null }],
    ["invalid_target", { resource: "https://bob.getbb.app/mcp" }],
    ["invalid_target", { resource: "https://nobody.getbb.app/mcp" }],
    ["invalid_target", { resource: "https://alice.getbb.app/other" }],
    ["invalid_target", { resource: "http://alice.getbb.app/mcp" }],
    ["invalid_target", { resource: "https://bob.next.getbb.app/mcp" }],
    ["invalid_target", { resource: "https://alice.next.getbb.app/other" }],
    ["invalid_target", { resource: "https://alice--8000.next.getbb.app/mcp" }],
    ["invalid_target", { resource: "https://alice.other.getbb.app/mcp" }],
    ["invalid_scope", { scope: "admin offline_access" }],
  ])("shows an error page naming %s for %o", async (error, over) => {
    for (const result of [
      await prepareOAuthAuthorization(
        ENV,
        db,
        "alice",
        authorizeParams(over),
        deps(),
      ),
      await completeOAuthAuthorization(
        ENV,
        db,
        "alice",
        authorizeParams(over),
        { approved: true },
        deps(),
      ),
      await completeOAuthAuthorization(
        ENV,
        db,
        "alice",
        authorizeParams(over),
        { approved: false },
        deps(),
      ),
    ]) {
      expect(result).toEqual({
        kind: "error-page",
        message: expect.stringContaining(error),
      });
    }
    expect(db.select().from(oauthCode).all()).toHaveLength(0);
  });

  it("never bounces a malformed request to an attacker-hosted client", async () => {
    const evilClient = "https://evil.example/c.json";
    const evilRedirect = "https://evil.example/x";
    const evilDeps = {
      fetch: fetchReturning(() =>
        Response.json(
          {
            client_id: evilClient,
            client_name: "Evil",
            redirect_uris: [evilRedirect],
          },
          { headers: JSON_HEADERS },
        ),
      ),
      now: () => now,
    };
    const params = authorizeParams({
      client_id: evilClient,
      redirect_uri: evilRedirect,
      response_type: "bogus",
    });
    const shown = await prepareOAuthAuthorization(
      ENV,
      db,
      "alice",
      params,
      evilDeps,
    );
    expect(shown.kind).toBe("error-page");
    expect(JSON.stringify(shown)).not.toContain("evil.example");
    for (const approved of [true, false]) {
      const decided = await completeOAuthAuthorization(
        ENV,
        db,
        "alice",
        params,
        { approved },
        evilDeps,
      );
      expect(decided.kind).toBe("error-page");
      expect(JSON.stringify(decided)).not.toContain("evil.example");
    }
    const wellFormed = authorizeParams({
      client_id: evilClient,
      redirect_uri: evilRedirect,
    });
    expect(
      (await prepareOAuthAuthorization(ENV, db, "alice", wellFormed, evilDeps))
        .kind,
    ).toBe("consent");
    const denied = await completeOAuthAuthorization(
      ENV,
      db,
      "alice",
      wellFormed,
      { approved: false },
      evilDeps,
    );
    expect(redirectParams(denied).get("error")).toBe("access_denied");
  });

  it("treats a revoked server as an invalid target", async () => {
    db.update(server)
      .set({ revokedAt: new Date(T0) })
      .where(eq(server.id, "srv-alice"))
      .run();
    const result = await prepareOAuthAuthorization(
      ENV,
      db,
      "alice",
      authorizeParams(),
      deps(),
    );
    expect(result).toEqual({
      kind: "error-page",
      message: expect.stringContaining("invalid_target"),
    });
  });

  it("returns access_denied without a code when the user declines", async () => {
    const result = await completeOAuthAuthorization(
      ENV,
      db,
      "alice",
      authorizeParams({ state: null }),
      { approved: false },
      deps(),
    );
    const params = redirectParams(result);
    expect(params.get("error")).toBe("access_denied");
    expect(params.has("state")).toBe(false);
    expect(db.select().from(oauthCode).all()).toHaveLength(0);
  });

  it("stores only the code hash and keeps the redirect URI query", async () => {
    const result = await completeOAuthAuthorization(
      ENV,
      db,
      "alice",
      authorizeParams(),
      { approved: true },
      deps(),
    );
    if (result.kind !== "redirect") throw new Error("expected redirect");
    const url = new URL(result.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://claude.example/callback",
    );
    expect(url.searchParams.get("tenant")).toBe("1");
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("iss")).toBe("https://getbb.app");
    const code = url.searchParams.get("code") ?? "";
    expect(code).toMatch(/^bbmcpc_[A-Za-z0-9_-]{43}$/u);
    const rows = db.select().from(oauthCode).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      codeHash: await sha256Hex(code),
      userId: "alice",
      serverId: "srv-alice",
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      resource: RESOURCE,
      scope: "bb",
      codeChallenge: challenge,
    });
    expect(rows[0]?.expiresAt.getTime()).toBe(T0 + OAUTH_CODE_TTL_MS);
  });

  it.each([["bb"], [null], [""], ["bb offline_access"]])(
    "grants scope bb when the requested scope is %o",
    async (scope) => {
      const body = await tokens(
        await tokenRequest(codeBody(await authorize({ scope }))),
      );
      expect(body.scope).toBe("bb");
      expect(grantRows()[0]?.scope).toBe("bb");
    },
  );
});

describe("token endpoint: authorization_code", () => {
  it("issues a verifiable access token and a hashed refresh token", async () => {
    const body = await exchange();
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(OAUTH_ACCESS_TOKEN_TTL_MS / 1000);
    expect(body.refresh_token).toMatch(/^bbmcpr_[A-Za-z0-9_-]{43}$/u);
    const grant = grantRows()[0];
    expect(grant).toMatchObject({
      userId: "alice",
      serverId: "srv-alice",
      clientId: CLIENT_ID,
      revokedAt: null,
    });
    expect(
      await verifyMcpAccessToken(body.access_token, ENV.BETTER_AUTH_SECRET, T0),
    ).toEqual({
      version: 1,
      userId: "alice",
      serverId: "srv-alice",
      grantId: grant?.id,
      resource: RESOURCE,
      scope: "bb",
      clientName: "Claude",
      issuedAt: T0,
      expiresAt: T0 + OAUTH_ACCESS_TOKEN_TTL_MS,
    });
    expect(
      await verifyMcpAccessToken(body.access_token, "other-secret", T0),
    ).toBeNull();
    const stored = db.select().from(oauthRefreshToken).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(await sha256Hex(body.refresh_token));
    expect(stored[0]?.expiresAt.getTime()).toBe(
      T0 + OAUTH_REFRESH_TOKEN_TTL_MS,
    );
    expect(auditActions()).toEqual(["mcp.oauth.grant"]);
  });

  it("binds a grant and its tokens to the next address it was issued for", async () => {
    const code = await authorize({ resource: NEXT_RESOURCE });
    await expectTokenError(
      await tokenRequest(codeBody(code, { resource: RESOURCE })),
      "invalid_grant",
    );
    const body = await tokens(
      await tokenRequest(
        codeBody(await authorize({ resource: NEXT_RESOURCE }), {
          resource: NEXT_RESOURCE,
        }),
      ),
    );
    expect(grantRows()).toHaveLength(1);
    expect(grantRows()[0]?.resource).toBe(NEXT_RESOURCE);
    expect(
      (
        await verifyMcpAccessToken(
          body.access_token,
          ENV.BETTER_AUTH_SECRET,
          T0,
        )
      )?.resource,
    ).toBe(NEXT_RESOURCE);
    await expectTokenError(
      await refresh(body.refresh_token, CLIENT_ID, { resource: RESOURCE }),
      "invalid_grant",
    );
    const refreshed = await tokens(
      await refresh(body.refresh_token, CLIENT_ID, { resource: NEXT_RESOURCE }),
    );
    expect(
      (
        await verifyMcpAccessToken(
          refreshed.access_token,
          ENV.BETTER_AUTH_SECRET,
          T0,
        )
      )?.resource,
    ).toBe(NEXT_RESOURCE);
  });

  it("refuses the next address when NEXT_BASE_DOMAIN is unset", async () => {
    const { NEXT_BASE_DOMAIN: _unset, ...withoutNext } = ENV;
    expect(
      await prepareOAuthAuthorization(
        withoutNext,
        db,
        "alice",
        authorizeParams({ resource: NEXT_RESOURCE }),
        deps(),
      ),
    ).toEqual({
      kind: "error-page",
      message: expect.stringContaining("invalid_target"),
    });
  });

  it("rejects a replayed code", async () => {
    const code = await authorize();
    await tokens(await tokenRequest(codeBody(code)));
    await expectTokenError(await tokenRequest(codeBody(code)), "invalid_grant");
    expect(grantRows()).toHaveLength(1);
  });

  it.each([
    ["a wrong PKCE verifier", { code_verifier: "w".repeat(64) }],
    ["a malformed PKCE verifier", { code_verifier: "short" }],
    ["a different redirect_uri", { redirect_uri: "http://127.0.0.1/cb" }],
    [
      "a different client_id",
      { client_id: "https://other.example/client.json" },
    ],
    ["a different resource", { resource: "https://alice2.getbb.app/mcp" }],
  ])("rejects %s and burns the code", async (_label, over) => {
    const code = await authorize();
    await expectTokenError(
      await tokenRequest(codeBody(code, over)),
      "invalid_grant",
    );
    await expectTokenError(await tokenRequest(codeBody(code)), "invalid_grant");
    expect(grantRows()).toHaveLength(0);
  });

  it("rejects an expired code", async () => {
    const code = await authorize();
    now = T0 + OAUTH_CODE_TTL_MS;
    await expectTokenError(await tokenRequest(codeBody(code)), "invalid_grant");
  });

  it("rejects a code whose server was revoked before the exchange", async () => {
    const code = await authorize();
    db.update(server)
      .set({ revokedAt: new Date(T0) })
      .where(eq(server.id, "srv-alice"))
      .run();
    await expectTokenError(await tokenRequest(codeBody(code)), "invalid_grant");
  });

  it("rejects missing parameters, other content types and grant types", async () => {
    const code = await authorize();
    await expectTokenError(
      await tokenRequest({ grant_type: "authorization_code", code }),
      "invalid_request",
    );
    await expectTokenError(
      await tokenRequest(codeBody(code), "application/json"),
      "invalid_request",
    );
    await expectTokenError(
      await tokenRequest({ grant_type: "client_credentials" }),
      "unsupported_grant_type",
    );
    await tokens(await tokenRequest(codeBody(code)));
  });

  it("accepts an exchange that omits redirect_uri", async () => {
    const { redirect_uri: _omitted, ...body } = codeBody(await authorize());
    const issued = await tokens(await tokenRequest(body));
    expect(issued.refresh_token).toMatch(/^bbmcpr_/u);
    expect(grantRows()).toHaveLength(1);
  });

  it("compares a presented resource after normalising it", async () => {
    await tokens(
      await tokenRequest(
        codeBody(await authorize(), {
          resource: "https://ALICE.getbb.app:443/mcp",
        }),
      ),
    );
    for (const resource of [
      "not a url",
      "https://alice.getbb.app/mcp?x=1",
      "https://alice.getbb.app/mcp/",
      "http://alice.getbb.app/mcp",
    ]) {
      await expectTokenError(
        await tokenRequest(codeBody(await authorize(), { resource })),
        "invalid_grant",
      );
    }
    expect(grantRows()).toHaveLength(1);
  });

  it("does not write when the code is unknown", async () => {
    await authorize();
    const before = sqlite.prepare("SELECT total_changes() AS n").get() as {
      n: number;
    };
    await expectTokenError(
      await tokenRequest(codeBody(`bbmcpc_${"A".repeat(43)}`)),
      "invalid_grant",
    );
    const after = sqlite.prepare("SELECT total_changes() AS n").get() as {
      n: number;
    };
    expect(after.n).toBe(before.n);
    expect(db.select().from(oauthCode).all()).toHaveLength(1);
  });

  it("keeps an earlier device connected when a second one connects", async () => {
    const laptop = await exchange();
    now += 1000;
    const desktop = await exchange();
    const grants = grantRows();
    expect(grants).toHaveLength(2);
    expect(grants.every((grant) => grant.revokedAt === null)).toBe(true);
    await tokens(await refresh(laptop.refresh_token));
    await tokens(await refresh(desktop.refresh_token));
    expect(auditActions()).toEqual(["mcp.oauth.grant", "mcp.oauth.grant"]);
    expect(await listOAuthGrantsForUser(db, "alice")).toHaveLength(2);
  });

  it("caps live grants per client and server by revoking the oldest", async () => {
    const issued: TokenBody[] = [];
    for (let index = 0; index < OAUTH_MAX_GRANTS_PER_CLIENT + 2; index += 1) {
      issued.push(await exchange());
      now += 1000;
    }
    const otherServer = await tokens(
      await tokenRequest(
        codeBody(await authorize({ resource: "https://alice2.getbb.app/mcp" })),
      ),
    );
    const live = grantRows().filter((grant) => grant.revokedAt === null);
    expect(live.filter((grant) => grant.serverId === "srv-alice")).toHaveLength(
      OAUTH_MAX_GRANTS_PER_CLIENT,
    );
    expect(revokeReasons()).toEqual(["superseded", "superseded"]);
    for (const oldest of issued.slice(0, 2)) {
      await expectTokenError(
        await refresh(oldest.refresh_token),
        "invalid_grant",
      );
    }
    for (const kept of [...issued.slice(2), otherServer]) {
      await tokens(await refresh(kept.refresh_token));
    }
  });

  it("deletes the user's long-revoked grants when a new grant is created", async () => {
    await exchange();
    await exchange();
    const [stale, recent] = grantRows();
    if (!stale || !recent) throw new Error("grants were not created");
    const revokeAt = (id: string, at: number) =>
      db
        .update(oauthGrant)
        .set({ revokedAt: new Date(at) })
        .where(eq(oauthGrant.id, id))
        .run();
    revokeAt(stale.id, T0);
    revokeAt(recent.id, T0 + 1000);
    db.insert(oauthGrant)
      .values({
        id: "bob-stale",
        userId: "bob",
        serverId: "srv-bob",
        clientId: CLIENT_ID,
        clientName: "Claude",
        resource: "https://bob.getbb.app/mcp",
        scope: "bb",
        createdAt: new Date(T0),
        revokedAt: new Date(T0),
      })
      .run();
    now = T0 + OAUTH_REVOKED_GRANT_RETENTION_MS + 500;
    await exchange();
    const remaining = grantRows().map((grant) => grant.id);
    expect(remaining).not.toContain(stale.id);
    expect(remaining).toContain(recent.id);
    expect(remaining).toContain("bob-stale");
    expect(remaining).toHaveLength(3);
  });
});

describe("token endpoint: refresh_token", () => {
  it("rotates the refresh token and keeps the grant's claims", async () => {
    const first = await exchange();
    now += 5 * 60 * 1000;
    const second = await tokens(await refresh(first.refresh_token));
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.scope).toBe("bb");
    const claims = await verifyMcpAccessToken(
      second.access_token,
      ENV.BETTER_AUTH_SECRET,
      now,
    );
    expect(claims).toMatchObject({
      grantId: grantRows()[0]?.id,
      scope: "bb",
      issuedAt: now,
      expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS,
    });
    expect(grantRows()[0]?.lastUsedAt?.getTime()).toBe(now);
    now += 5 * 60 * 1000;
    await tokens(await refresh(second.refresh_token));
  });

  it("gives a client that retries inside the grace window the same new refresh token", async () => {
    const first = await exchange();
    const second = await tokens(await refresh(first.refresh_token));
    now += OAUTH_REFRESH_REUSE_GRACE_MS;
    const retried = await tokens(await refresh(first.refresh_token));
    expect(retried.refresh_token).toBe(second.refresh_token);
    expect(retried.access_token).not.toBe(second.access_token);
    expect(liveRefreshRowCount()).toBe(1);
    expect(grantRows()[0]?.revokedAt).toBeNull();
    const next = await tokens(await refresh(second.refresh_token));
    expect(liveRefreshRowCount()).toBe(1);
    await tokens(await refresh(next.refresh_token));
  });

  it("keeps one token chain when a rotated token is replayed inside the grace window after its successor was used", async () => {
    const first = await exchange();
    const second = await tokens(await refresh(first.refresh_token));
    const third = await tokens(await refresh(second.refresh_token));
    now += 1000;
    const replayed = await tokens(await refresh(first.refresh_token));
    expect(replayed.refresh_token).toBe(second.refresh_token);
    expect(liveRefreshRowCount()).toBe(1);
    expect(grantRows()[0]?.revokedAt).toBeNull();
    now += OAUTH_REFRESH_REUSE_GRACE_MS + 1;
    await expectTokenError(
      await refresh(replayed.refresh_token),
      "invalid_grant",
    );
    expect(revokeReasons()).toEqual(["reuse"]);
    await expectTokenError(await refresh(third.refresh_token), "invalid_grant");
  });

  it("gives two refreshes issued back to back the same refresh token", async () => {
    const first = await exchange();
    const responses = await Promise.all([
      refresh(first.refresh_token),
      refresh(first.refresh_token),
    ]);
    const issued: string[] = [];
    for (const response of responses) {
      issued.push((await tokens(response)).refresh_token);
    }
    expect(new Set(issued).size).toBe(1);
    expect(liveRefreshRowCount()).toBe(1);
    expect(db.select().from(oauthRefreshToken).all()).toHaveLength(2);
    expect(grantRows()[0]?.revokedAt).toBeNull();
    await tokens(await refresh(issued[0] ?? ""));
  });

  it("derives refresh tokens that cannot be predicted from an earlier one", async () => {
    const first = await exchange();
    const second = await tokens(await refresh(first.refresh_token));
    const other = await exchange();
    const otherSecond = await tokens(await refresh(other.refresh_token));
    expect(second.refresh_token).toMatch(/^bbmcpr_[A-Za-z0-9_-]{43}$/u);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(otherSecond.refresh_token).not.toBe(second.refresh_token);
  });

  it("compares a presented resource after normalising it", async () => {
    const first = await exchange();
    const second = await tokens(
      await refresh(first.refresh_token, CLIENT_ID, {
        resource: "https://ALICE.getbb.app:443/mcp",
      }),
    );
    for (const resource of [
      "not a url",
      "https://alice2.getbb.app/mcp",
      "https://alice.getbb.app/mcp?x=1",
    ]) {
      await expectTokenError(
        await refresh(second.refresh_token, CLIENT_ID, { resource }),
        "invalid_grant",
      );
    }
    expect(grantRows()[0]?.revokedAt).toBeNull();
    await tokens(await refresh(second.refresh_token));
  });

  it("revokes the grant when a rotated token is reused after the grace window", async () => {
    const first = await exchange();
    const second = await tokens(await refresh(first.refresh_token));
    now += OAUTH_REFRESH_REUSE_GRACE_MS + 1;
    await expectTokenError(await refresh(first.refresh_token), "invalid_grant");
    expect(grantRows()[0]?.revokedAt?.getTime()).toBe(now);
    await expectTokenError(
      await refresh(second.refresh_token),
      "invalid_grant",
    );
    expect(auditActions()).toEqual(["mcp.oauth.grant", "mcp.oauth.revoke"]);
  });

  it("keeps a bounded number of refresh rows for a long-lived grant", async () => {
    let current = await exchange();
    for (let hour = 0; hour < 72; hour += 1) {
      now += 60 * 60 * 1000;
      current = await tokens(await refresh(current.refresh_token));
    }
    const rows = sqlite
      .prepare("SELECT COUNT(*) AS count FROM oauth_refresh_token")
      .get() as { count: number };
    expect(rows.count).toBeLessThanOrEqual(26);
    expect(grantRows()[0]?.revokedAt).toBeNull();
  });

  it("still detects reuse of a token rotated within the retention window", async () => {
    const first = await exchange();
    let current = await tokens(await refresh(first.refresh_token));
    for (let hour = 0; hour < 20; hour += 1) {
      now += 60 * 60 * 1000;
      current = await tokens(await refresh(current.refresh_token));
    }
    await expectTokenError(await refresh(first.refresh_token), "invalid_grant");
    expect(grantRows()[0]?.revokedAt?.getTime()).toBe(now);
    await expectTokenError(
      await refresh(current.refresh_token),
      "invalid_grant",
    );
  });

  it("rejects malformed codes and refresh tokens", async () => {
    await exchange();
    for (const malformed of [
      "bbmcpr_",
      "bbmcpr_short",
      `bbmcpr_${"a".repeat(44)}`,
      `bbmcpr_${"a".repeat(42)}!`,
      "a".repeat(50),
    ]) {
      await expectTokenError(await refresh(malformed), "invalid_grant");
      expect((await revokeRequest(malformed)).status).toBe(200);
    }
    await expectTokenError(
      await tokenRequest(codeBody("bbmcpc_not-a-real-code")),
      "invalid_grant",
    );
    expect(grantRows()[0]?.revokedAt).toBeNull();
  });

  it("rejects unknown, expired and wrong-client refresh tokens", async () => {
    const first = await exchange();
    await expectTokenError(await refresh("bbmcpr_unknown"), "invalid_grant");
    await expectTokenError(
      await refresh(first.refresh_token, "https://other.example/client.json"),
      "invalid_grant",
    );
    await expectTokenError(
      await tokenRequest({ grant_type: "refresh_token", client_id: CLIENT_ID }),
      "invalid_request",
    );
    now = T0 + OAUTH_REFRESH_TOKEN_TTL_MS;
    await expectTokenError(await refresh(first.refresh_token), "invalid_grant");
    expect(grantRows()[0]?.revokedAt).toBeNull();
  });

  it("refuses to refresh a revoked grant", async () => {
    const first = await exchange();
    const grantId = grantRows()[0]?.id ?? "";
    expect(await revokeOAuthGrantForUser(db, "bob", grantId)).toBe(false);
    expect(await revokeOAuthGrantForUser(db, "alice", grantId)).toBe(true);
    expect(await revokeOAuthGrantForUser(db, "alice", grantId)).toBe(false);
    await expectTokenError(await refresh(first.refresh_token), "invalid_grant");
    expect(await listOAuthGrantsForUser(db, "alice")).toEqual([]);
  });

  it("refuses to refresh once the server is revoked or changes owner", async () => {
    const first = await exchange();
    db.update(server)
      .set({ userId: "bob" })
      .where(eq(server.id, "srv-alice"))
      .run();
    await expectTokenError(await refresh(first.refresh_token), "invalid_grant");
    db.update(server)
      .set({ userId: "alice", revokedAt: new Date(T0) })
      .where(eq(server.id, "srv-alice"))
      .run();
    await expectTokenError(await refresh(first.refresh_token), "invalid_grant");
  });
});

describe("revocation endpoint", () => {
  it("revokes the grant for a refresh token or a valid access token", async () => {
    const first = await exchange();
    const response = await revokeRequest(first.refresh_token);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(grantRows()[0]?.revokedAt).not.toBeNull();

    now += 1000;
    const second = await exchange();
    expect((await revokeRequest(second.access_token)).status).toBe(200);
    expect(grantRows().every((grant) => grant.revokedAt !== null)).toBe(true);
    await expectTokenError(
      await refresh(second.refresh_token),
      "invalid_grant",
    );
  });

  it("answers 200 and revokes nothing for unknown or expired tokens", async () => {
    const first = await exchange();
    expect((await revokeRequest("garbage")).status).toBe(200);
    expect((await revokeRequest("bbmcpr_unknown")).status).toBe(200);
    now = T0 + OAUTH_ACCESS_TOKEN_TTL_MS;
    expect((await revokeRequest(first.access_token)).status).toBe(200);
    expect(grantRows()[0]?.revokedAt).toBeNull();
  });
});

describe("grant management", () => {
  it("lists a user's active grants across servers", async () => {
    await exchange();
    now += 1000;
    await tokens(
      await tokenRequest(
        codeBody(await authorize({ resource: "https://alice2.getbb.app/mcp" })),
      ),
    );
    const grants = await listOAuthGrantsForUser(db, "alice");
    expect(grants).toMatchObject([
      {
        clientId: CLIENT_ID,
        clientName: "Claude",
        serverId: "srv-alice-2",
        serverHandle: "alice2",
        scope: "bb",
        createdAt: T0 + 1000,
        lastUsedAt: null,
      },
      { serverId: "srv-alice", serverHandle: "alice", createdAt: T0 },
    ]);
    expect(await listOAuthGrantsForUser(db, "bob")).toEqual([]);
  });

  it("scopes the credential API to that credential's server", async () => {
    await exchange();
    const grantId = grantRows()[0]?.id ?? "";
    expect(await listOAuthGrantsForCredential(db, "bbcred_wrong")).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    expect(await listOAuthGrantsForCredential(db, "bbcred_two")).toEqual({
      status: 200,
      body: { grants: [] },
    });
    expect(
      await listOAuthGrantsForCredential(db, "bbcred_alice"),
    ).toMatchObject({
      status: 200,
      body: { grants: [{ id: grantId, serverHandle: "alice" }] },
    });

    expect(
      await revokeOAuthGrantForCredential(db, "bbcred_wrong", { grantId }),
    ).toMatchObject({ status: 401 });
    expect(
      await revokeOAuthGrantForCredential(db, "bbcred_alice", { grantId: 7 }),
    ).toMatchObject({ status: 400 });
    expect(
      await revokeOAuthGrantForCredential(db, "bbcred_two", { grantId }),
    ).toEqual({ status: 200, body: { revoked: false } });
    expect(grantRows()[0]?.revokedAt).toBeNull();
    expect(
      await revokeOAuthGrantForCredential(
        db,
        "bbcred_alice",
        { grantId },
        { now: () => now },
      ),
    ).toEqual({ status: 200, body: { revoked: true } });
    expect(grantRows()[0]?.revokedAt?.getTime()).toBe(now);
    expect(db.select().from(oauthRefreshToken).all()).toHaveLength(0);
    expect(auditActions()).toEqual(["mcp.oauth.grant", "mcp.oauth.revoke"]);
  });
});
