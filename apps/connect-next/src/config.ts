import { NEXT_BASE_DOMAIN } from "@bb/tunnel-contract/next";

export interface PeerConfig {
  secret: string;
  appName: string;
  internalPort: number;
  internalBindHost: string;
  refreshMs: number;
}

export interface ConnectNextConfig {
  baseDomain: string;
  scheme: "http" | "https";
  accountApiUrl: string;
  gateSecret: string;
  accountAppUrl: string;
  signingKeyJwk: JsonWebKey & { kid?: string };
  assetLinksFingerprints: string;
  region: string;
  gateMachineId: string;
  bindHost: string;
  ports: {
    web: number;
    frpBind: number;
    vhost: number;
    hooks: number;
    frpTcp: number | null;
  };
  frps: string;
  frpLogLevel: string;
  cacheMaxBytes: number;
  cacheMaxEntryBytes: number;
  presenceRefreshMs: number;
  peers: PeerConfig | null;
}

type Env = Record<string, string | undefined>;

function read(env: Env, name: string, fallback?: string): string {
  const value = env[name]?.trim() || fallback;
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function port(env: Env, name: string, fallback: string): number {
  const value = Number(read(env, name, fallback));
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`${name} must be a port number`);
  }
  return value;
}

function positive(env: Env, name: string, fallback: string): number {
  const value = Number(read(env, name, fallback));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function origin(env: Env, name: string, fallback?: string): string {
  const url = new URL(read(env, name, fallback));
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${name} must be an HTTP(S) origin`);
  }
  return url.origin;
}

function signingKey(env: Env): JsonWebKey & { kid: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(read(env, "GATE_SIGNING_KEY"));
  } catch {
    throw new Error("GATE_SIGNING_KEY must be a private JWK in JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("GATE_SIGNING_KEY must be a private JWK in JSON");
  }
  const { kid, kty, crv, x, d } = parsed as Record<string, unknown>;
  if (
    typeof kid !== "string" ||
    kid === "" ||
    kty !== "OKP" ||
    crv !== "Ed25519" ||
    typeof x !== "string" ||
    typeof d !== "string"
  ) {
    throw new Error(
      "GATE_SIGNING_KEY must be a private Ed25519 JWK with a kid",
    );
  }
  return { kid, kty, crv, x, d };
}

function peers(env: Env): PeerConfig | null {
  const secret = env.PEER_SECRET?.trim();
  if (!secret) return null;
  if (secret.length < 32) {
    throw new Error("PEER_SECRET must be at least 32 characters");
  }
  return {
    secret,
    appName: read(env, "FLY_APP_NAME"),
    internalPort: port(env, "INTERNAL_PORT", "7100"),
    internalBindHost: read(env, "INTERNAL_BIND_HOST", "fly-local-6pn"),
    refreshMs: positive(env, "PEER_REFRESH_MS", "30000"),
  };
}

export function configFromEnv(env: Env): ConnectNextConfig {
  const scheme = read(env, "PUBLIC_SCHEME", "https");
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("PUBLIC_SCHEME must be http or https");
  }
  const frpTcp = env.FRP_TCP_PORT?.trim();
  return {
    baseDomain: read(env, "BASE_DOMAIN", NEXT_BASE_DOMAIN).toLowerCase(),
    scheme,
    accountApiUrl: origin(env, "ACCOUNT_API_URL"),
    gateSecret: read(env, "GATE_SECRET"),
    accountAppUrl: origin(env, "ACCOUNT_APP_URL", "https://getbb.app"),
    signingKeyJwk: signingKey(env),
    assetLinksFingerprints: env.ASSETLINKS_SHA256_FINGERPRINTS?.trim() ?? "",
    region: read(env, "FLY_REGION", "local"),
    gateMachineId: read(env, "FLY_MACHINE_ID", "local"),
    bindHost: read(env, "BIND_HOST", "0.0.0.0"),
    ports: {
      web: port(env, "PORT", "8080"),
      frpBind: port(env, "FRP_BIND_PORT", "7001"),
      vhost: port(env, "FRP_VHOST_PORT", "7080"),
      hooks: port(env, "FRP_HOOKS_PORT", "7090"),
      frpTcp: frpTcp ? port(env, "FRP_TCP_PORT", frpTcp) : null,
    },
    frps: read(env, "FRPS", "frps"),
    frpLogLevel: read(env, "FRP_LOG_LEVEL", "info"),
    cacheMaxBytes: positive(env, "CACHE_MAX_BYTES", String(256 * 1024 * 1024)),
    cacheMaxEntryBytes: positive(
      env,
      "CACHE_MAX_ENTRY_BYTES",
      String(8 * 1024 * 1024),
    ),
    presenceRefreshMs: positive(env, "PRESENCE_REFRESH_MS", "240000"),
    peers: peers(env),
  };
}
