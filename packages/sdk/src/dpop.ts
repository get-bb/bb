export interface DpopPublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export interface DpopSigner {
  readonly publicJwk: DpopPublicJwk;
  sign(data: Uint8Array): Promise<Uint8Array>;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  randomId(): string;
}

export interface CreateDpopProofArgs {
  signer: DpopSigner;
  method: string;
  url: string;
  accessToken?: string;
  nowMs?: number;
}

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64UrlEncode(bytes: Uint8Array): string {
  let output = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const value =
      (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    output +=
      BASE64URL_ALPHABET[(value >> 18) & 63]! +
      BASE64URL_ALPHABET[(value >> 12) & 63]! +
      BASE64URL_ALPHABET[(value >> 6) & 63]! +
      BASE64URL_ALPHABET[value & 63]!;
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const value = bytes[index]! << 16;
    output +=
      BASE64URL_ALPHABET[(value >> 18) & 63]! +
      BASE64URL_ALPHABET[(value >> 12) & 63]!;
  } else if (remaining === 2) {
    const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8);
    output +=
      BASE64URL_ALPHABET[(value >> 18) & 63]! +
      BASE64URL_ALPHABET[(value >> 12) & 63]! +
      BASE64URL_ALPHABET[(value >> 6) & 63]!;
  }
  return output;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function normalizeDpopHtu(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

export async function createDpopProof(
  args: CreateDpopProofArgs,
): Promise<string> {
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: {
      kty: args.signer.publicJwk.kty,
      crv: args.signer.publicJwk.crv,
      x: args.signer.publicJwk.x,
      y: args.signer.publicJwk.y,
    },
  };
  const payload: Record<string, string | number> = {
    htm: args.method.toUpperCase(),
    htu: normalizeDpopHtu(args.url),
    jti: args.signer.randomId(),
    iat: Math.floor((args.nowMs ?? Date.now()) / 1000),
  };
  if (args.accessToken !== undefined) {
    payload.ath = base64UrlEncode(
      await args.signer.sha256(utf8(args.accessToken)),
    );
  }
  const signingInput = `${base64UrlEncode(utf8(JSON.stringify(header)))}.${base64UrlEncode(utf8(JSON.stringify(payload)))}`;
  const signature = await args.signer.sign(utf8(signingInput));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
