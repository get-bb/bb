import { p256 } from "@noble/curves/nist.js";
import { base64UrlEncode, type DpopSigner } from "@bb/sdk/dpop";
import { z } from "zod";

export const devicePrivateJwkSchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(1),
    y: z.string().min(1),
    d: z.string().min(1),
  })
  .strict();
export type DevicePrivateJwk = z.infer<typeof devicePrivateJwkSchema>;

export interface DeviceCryptoDeps {
  sha256(data: Uint8Array): Promise<Uint8Array>;
  randomId(): string;
}

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64UrlDecode(value: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of value) {
    const index = BASE64URL_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base64url");
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

export function generateDevicePrivateJwk(): DevicePrivateJwk {
  const secretKey = p256.utils.randomSecretKey();
  const publicKey = p256.getPublicKey(secretKey, false);
  return {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicKey.slice(1, 33)),
    y: base64UrlEncode(publicKey.slice(33, 65)),
    d: base64UrlEncode(secretKey),
  };
}

export function createDeviceSigner(
  privateJwk: DevicePrivateJwk,
  deps: DeviceCryptoDeps,
): DpopSigner {
  const secretKey = base64UrlDecode(privateJwk.d);
  return {
    publicJwk: {
      kty: "EC",
      crv: "P-256",
      x: privateJwk.x,
      y: privateJwk.y,
    },
    async sign(data) {
      return p256.sign(data, secretKey);
    },
    sha256: deps.sha256,
    randomId: deps.randomId,
  };
}
