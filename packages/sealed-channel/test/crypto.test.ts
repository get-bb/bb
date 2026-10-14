import { describe, expect, it } from "vitest";
import {
  deserializeSigningKeyPair,
  deviceIdFromPublicKey,
  generateSigningKeyPair,
  isValidPublicKey,
  keyFingerprint,
  serializeSigningKeyPair,
  sign,
  verify,
} from "../src/crypto.js";
import { base64UrlDecode, base64UrlEncode } from "../src/bytes.js";

describe("signing keys", () => {
  it("round-trips through serialization and signs verifiably", () => {
    const pair = generateSigningKeyPair();
    const restored = deserializeSigningKeyPair(serializeSigningKeyPair(pair));
    expect(restored.publicKey).toEqual(pair.publicKey);
    const message = new TextEncoder().encode("hello");
    const signature = sign(message, restored.secretKey);
    expect(verify(signature, message, pair.publicKey)).toBe(true);
    expect(
      verify(signature, new TextEncoder().encode("hellO"), pair.publicKey),
    ).toBe(false);
    expect(verify(signature, message, generateSigningKeyPair().publicKey)).toBe(
      false,
    );
  });

  it("rejects a serialized pair whose public key does not match", () => {
    const pair = serializeSigningKeyPair(generateSigningKeyPair());
    const other = serializeSigningKeyPair(generateSigningKeyPair());
    expect(() =>
      deserializeSigningKeyPair({
        publicKey: other.publicKey,
        secretKey: pair.secretKey,
      }),
    ).toThrow("public key mismatch");
  });

  it("formats a stable fingerprint and device id", () => {
    const pair = generateSigningKeyPair();
    const fingerprint = keyFingerprint(pair.publicKey);
    expect(fingerprint).toMatch(/^([0-9A-F]{4}-){5}[0-9A-F]{4}$/u);
    expect(keyFingerprint(pair.publicKey)).toBe(fingerprint);
    expect(deviceIdFromPublicKey(pair.publicKey)).toMatch(
      /^dev_[0-9a-f]{16}$/u,
    );
    expect(keyFingerprint(generateSigningKeyPair().publicKey)).not.toBe(
      fingerprint,
    );
  });

  it("validates public keys", () => {
    expect(isValidPublicKey(generateSigningKeyPair().publicKey)).toBe(true);
    expect(isValidPublicKey(new Uint8Array(31))).toBe(false);
  });
});

describe("base64url", () => {
  it("round-trips arbitrary bytes without padding", () => {
    for (const length of [0, 1, 2, 3, 4, 31, 32, 33, 64]) {
      const bytes = new Uint8Array(length).map(
        (_, index) => (index * 37 + 11) % 256,
      );
      const encoded = base64UrlEncode(bytes);
      expect(encoded).not.toContain("=");
      expect(base64UrlDecode(encoded)).toEqual(bytes);
    }
  });
});
