import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  concatBytes,
  hexEncode,
  utf8Encode,
  writeUint64BE,
} from "./bytes.js";

export const SEALED_PROTOCOL_VERSION = 1;
const PROTOCOL_LABEL = "bb-sealed-v1";

export const PUBLIC_KEY_BYTES = 32;
export const SECRET_KEY_BYTES = 32;
export const SIGNATURE_BYTES = 64;
export const AEAD_KEY_BYTES = 32;
export const AEAD_NONCE_BYTES = 12;
export const AEAD_TAG_BYTES = 16;

export interface SigningKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface SerializedSigningKeyPair {
  publicKey: string;
  secretKey: string;
}

export function generateSigningKeyPair(): SigningKeyPair {
  const secretKey = ed25519.utils.randomSecretKey();
  return { publicKey: ed25519.getPublicKey(secretKey), secretKey };
}

export function signingKeyPairFromSecret(
  secretKey: Uint8Array,
): SigningKeyPair {
  if (secretKey.length !== SECRET_KEY_BYTES) {
    throw new Error("sealed-channel: signing secret key must be 32 bytes");
  }
  return { publicKey: ed25519.getPublicKey(secretKey), secretKey };
}

export function serializeSigningKeyPair(
  pair: SigningKeyPair,
): SerializedSigningKeyPair {
  return {
    publicKey: base64UrlEncode(pair.publicKey),
    secretKey: base64UrlEncode(pair.secretKey),
  };
}

export function deserializeSigningKeyPair(
  serialized: SerializedSigningKeyPair,
): SigningKeyPair {
  const pair = signingKeyPairFromSecret(base64UrlDecode(serialized.secretKey));
  const expectedPublic = base64UrlDecode(serialized.publicKey);
  if (hexEncode(expectedPublic) !== hexEncode(pair.publicKey)) {
    throw new Error("sealed-channel: signing key pair public key mismatch");
  }
  return pair;
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, secretKey);
}

export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (
    signature.length !== SIGNATURE_BYTES ||
    publicKey.length !== PUBLIC_KEY_BYTES
  ) {
    return false;
  }
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function isValidPublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== PUBLIC_KEY_BYTES) return false;
  try {
    ed25519.Point.fromBytes(publicKey);
    return true;
  } catch {
    return false;
  }
}

export interface EphemeralKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  return { publicKey: x25519.getPublicKey(secretKey), secretKey };
}

export function sharedSecret(
  secretKey: Uint8Array,
  peerPublicKey: Uint8Array,
): Uint8Array {
  if (peerPublicKey.length !== PUBLIC_KEY_BYTES) {
    throw new Error("sealed-channel: peer ephemeral key must be 32 bytes");
  }
  return x25519.getSharedSecret(secretKey, peerPublicKey);
}

export function hash(...parts: Uint8Array[]): Uint8Array {
  return sha256(concatBytes(...parts));
}

export function labeledHash(label: string, ...parts: Uint8Array[]): Uint8Array {
  return hash(utf8Encode(`${PROTOCOL_LABEL}/${label}`), ...parts);
}

export function deriveKey(
  secret: Uint8Array,
  salt: Uint8Array,
  label: string,
): Uint8Array {
  return hkdf(
    sha256,
    secret,
    salt,
    utf8Encode(`${PROTOCOL_LABEL}/${label}`),
    AEAD_KEY_BYTES,
  );
}

export function mac(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha256, key, message);
}

export function randomNonceBytes(length: number): Uint8Array {
  return randomBytes(length);
}

function aeadNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(AEAD_NONCE_BYTES);
  writeUint64BE(counter, nonce, 4);
  return nonce;
}

export function aeadSeal(
  key: Uint8Array,
  counter: number,
  plaintext: Uint8Array,
  associatedData: Uint8Array,
): Uint8Array {
  return chacha20poly1305(key, aeadNonce(counter), associatedData).encrypt(
    plaintext,
  );
}

export function aeadOpen(
  key: Uint8Array,
  counter: number,
  ciphertext: Uint8Array,
  associatedData: Uint8Array,
): Uint8Array | null {
  try {
    return chacha20poly1305(key, aeadNonce(counter), associatedData).decrypt(
      ciphertext,
    );
  } catch {
    return null;
  }
}

export function keyFingerprint(publicKey: Uint8Array): string {
  const digest = hexEncode(labeledHash("fingerprint", publicKey)).toUpperCase();
  const groups: string[] = [];
  for (let index = 0; index < 24; index += 4) {
    groups.push(digest.slice(index, index + 4));
  }
  return groups.join("-");
}

export function deviceIdFromPublicKey(publicKey: Uint8Array): string {
  return `dev_${hexEncode(labeledHash("device-id", publicKey)).slice(0, 16)}`;
}
