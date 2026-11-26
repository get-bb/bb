import { createHash, createPublicKey, verify } from "node:crypto";

export const FAKE_SERVER_URL = "http://192.168.1.20:38886";

interface ProofClaims {
  header: { typ: string; alg: string; jwk: { x: string; y: string } };
  payload: { htm: string; htu: string; jti: string; iat: number; ath?: string };
}

export interface FakeDpopServerOptions {
  validCode: string;
  now: () => number;
  accessTokenTtlMs?: number;
}

export interface FakeDpopServer {
  fetch: typeof fetch;
  calls: string[];
  revoke(): void;
  expireTokens(): void;
  rejectNextProofs(count: number): void;
  readonly boundThumbprint: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function thumbprint(jwk: { x: string; y: string }): string {
  return sha256(
    JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y }),
  );
}

function normalizedUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function verifyProof(
  proof: string | null,
  args: { method: string; url: string; accessToken: string | null },
): { ok: true; jkt: string; jti: string } | { ok: false; reason: string } {
  if (proof === null) return { ok: false, reason: "missing" };
  const [h, p, sig] = proof.split(".");
  if (h === undefined || p === undefined || sig === undefined) {
    return { ok: false, reason: "malformed" };
  }
  const claims: ProofClaims = {
    header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
  };
  if (claims.header.typ !== "dpop+jwt" || claims.header.alg !== "ES256") {
    return { ok: false, reason: "header" };
  }
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: claims.header.jwk.x,
      y: claims.header.jwk.y,
    },
    format: "jwk",
  });
  const valid = verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(sig, "base64url"),
  );
  if (!valid) return { ok: false, reason: "signature" };
  if (claims.payload.htm !== args.method.toUpperCase()) {
    return { ok: false, reason: "htm" };
  }
  if (claims.payload.htu !== normalizedUrl(args.url)) {
    return { ok: false, reason: "htu" };
  }
  if (
    args.accessToken !== null &&
    claims.payload.ath !== sha256(args.accessToken)
  ) {
    return { ok: false, reason: "ath" };
  }
  return {
    ok: true,
    jkt: thumbprint(claims.header.jwk),
    jti: claims.payload.jti,
  };
}

export function createFakeDpopServer(
  options: FakeDpopServerOptions,
): FakeDpopServer {
  const ttl = options.accessTokenTtlMs ?? 60 * 60_000;
  const calls: string[] = [];
  const seenJtis = new Set<string>();
  let boundThumbprint: string | null = null;
  let revoked = false;
  let tokenSerial = 0;
  let validTokens = new Map<string, number>();
  let rejectProofs = 0;

  const issueToken = (): {
    accessToken: string;
    accessTokenExpiresAt: number;
  } => {
    tokenSerial += 1;
    const accessToken = `bbt_${tokenSerial}`;
    const accessTokenExpiresAt = options.now() + ttl;
    validTokens.set(accessToken, accessTokenExpiresAt);
    return { accessToken, accessTokenExpiresAt };
  };

  const checkProof = (
    request: { method: string; url: string; headers: Headers },
    accessToken: string | null,
  ): Response | null => {
    if (rejectProofs > 0) {
      rejectProofs -= 1;
      return json(401, { code: "invalid_dpop_proof" });
    }
    const verified = verifyProof(request.headers.get("dpop"), {
      method: request.method,
      url: request.url,
      accessToken,
    });
    if (!verified.ok || seenJtis.has(verified.jti)) {
      return json(401, { code: "invalid_dpop_proof" });
    }
    seenJtis.add(verified.jti);
    if (boundThumbprint !== null && verified.jkt !== boundThumbprint) {
      return json(401, { code: "invalid_dpop_proof" });
    }
    boundThumbprint ??= verified.jkt;
    return null;
  };

  const handle = (request: {
    method: string;
    url: string;
    headers: Headers;
    body: string | null;
  }): Response => {
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    if (path === "/health") return json(200, { ok: true });
    if (path === "/api/v1/access/pairings/redeem") {
      const rejected = checkProof(request, null);
      if (rejected) return rejected;
      const body = JSON.parse(request.body ?? "{}") as {
        code?: string;
        kind?: string;
      };
      if (body.kind !== "device" || body.code !== options.validCode) {
        return json(401, { code: "invalid_pairing_code" });
      }
      return json(200, {
        kind: "device",
        credential: { id: "acc_phone" },
        ...issueToken(),
      });
    }
    const authorization = request.headers.get("authorization") ?? "";
    const token = /^DPoP (\S+)$/u.exec(authorization)?.[1] ?? null;
    if (token === null) return json(401, { code: "unauthenticated" });
    if (path === "/api/v1/access/token") {
      if (revoked) return json(401, { code: "unauthenticated" });
      const rejected = checkProof(request, null);
      if (rejected) return rejected;
      if (!validTokens.has(token))
        return json(401, { code: "unauthenticated" });
      return json(200, {
        ...issueToken(),
        sessionExpiresAt: options.now() + 30 * 24 * 60 * 60_000,
      });
    }
    if (revoked) return json(401, { code: "unauthenticated" });
    const rejected = checkProof(request, token);
    if (rejected) return rejected;
    const expiresAt = validTokens.get(token);
    if (expiresAt === undefined) return json(401, { code: "unauthenticated" });
    if (expiresAt <= options.now()) {
      return json(401, { code: "access_token_expired" });
    }
    if (path === "/api/v1/system/config") {
      return json(200, { serverUrl: FAKE_SERVER_URL, primaryHostId: null });
    }
    if (path === "/api/v1/access/device-browser-sessions") {
      return json(200, {
        token: "bbs_child",
        cookieName: "bb_session_38886",
        expiresAt: options.now() + 60 * 60_000,
      });
    }
    if (path === "/api/v1/access/websocket-tickets") {
      return json(200, {
        ticket: "bbt_ticket",
        expiresAt: options.now() + 300_000,
      });
    }
    return json(404, { code: "not_found" });
  };

  return {
    calls,
    get boundThumbprint() {
      return boundThumbprint;
    },
    revoke() {
      revoked = true;
    },
    expireTokens() {
      validTokens = new Map(
        [...validTokens.keys()].map((token) => [token, options.now() - 1]),
      );
    },
    rejectNextProofs(count) {
      rejectProofs = count;
    },
    fetch: async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return handle({
        method: init?.method ?? "GET",
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : null,
      });
    },
  };
}

export const nodeDeviceCrypto = {
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    return createHash("sha256").update(data).digest();
  },
  randomId(): string {
    return crypto.randomUUID();
  },
};
