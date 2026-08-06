import { describe, expect, it } from "vitest";
import {
  INTERNAL_REQUEST_TARGET_VERSION,
  NonCanonicalInternalRequestTargetError,
  canonicalizeInternalRequestTarget,
} from "../src/internal-request-target.js";

function expectRejected(target: string): void {
  expect(() => canonicalizeInternalRequestTarget(target)).toThrow(
    NonCanonicalInternalRequestTargetError,
  );
  try {
    canonicalizeInternalRequestTarget(target);
  } catch (error) {
    expect(error).toBeInstanceOf(NonCanonicalInternalRequestTargetError);
    if (target.length > 0) {
      expect((error as Error).message).not.toContain(target);
    }
    expect((error as Error).message.toLowerCase()).not.toMatch(
      /secret|token|bearer|password/,
    );
  }
}

describe("canonicalizeInternalRequestTarget v1", () => {
  it("exports a stable version constant", () => {
    expect(INTERNAL_REQUEST_TARGET_VERSION).toBe(1);
  });

  it("accepts a plain path and returns the same string", () => {
    const target = "/api/v1/projects";
    expect(canonicalizeInternalRequestTarget(target)).toBe(target);
  });

  it("allows trailing and internal empty path segments", () => {
    expect(canonicalizeInternalRequestTarget("/api//v1/")).toBe("/api//v1/");
    expect(canonicalizeInternalRequestTarget("/")).toBe("/");
  });

  it("accepts an ordered canonical query", () => {
    const target = "/api/v1/items?limit=10&offset=0";
    expect(canonicalizeInternalRequestTarget(target)).toBe(target);
  });

  it("accepts an empty query value", () => {
    const target = "/search?q=";
    expect(canonicalizeInternalRequestTarget(target)).toBe(target);
  });

  it("accepts canonically percent-encoded NFC UTF-8", () => {
    // é in NFC is U+00E9 → %C3%A9
    const target = "/caf%C3%A9?label=%C3%A9";
    expect(canonicalizeInternalRequestTarget(target)).toBe(target);
  });

  it("rejects absolute URLs, network-path, fragments, controls, spaces, and backslashes", () => {
    expectRejected("https://example.test/api");
    expectRejected("//example.test/api");
    expectRejected("/api#frag");
    expectRejected("/api/\u0000x");
    expectRejected("/api /x");
    expectRejected("/api\\x");
  });

  it("rejects raw, lowercase, encoded-unreserved, double-encoded, and malformed percent escapes", () => {
    expectRejected("/cafés");
    expectRejected("/caf%c3%a9");
    expectRejected("/api/%61");
    expectRejected("/api/%252F");
    expectRejected("/api/%ZZ");
    expectRejected("/api/%");
  });

  it("rejects decoded slash and backslash in components", () => {
    expectRejected("/api/%2Fsecret");
    expectRejected("/api/%5Csecret");
    expectRejected("/api?path=%2Fetc");
    expectRejected("/api?path=%5Cetc");
  });

  it("rejects literal and encoded dot segments", () => {
    expectRejected("/api/./x");
    expectRejected("/api/../x");
    expectRejected("/api/%2E/x");
    expectRejected("/api/%2E%2E/x");
  });

  it("rejects trailing ?, empty query fields, missing =, and empty keys", () => {
    expectRejected("/api?");
    expectRejected("/api?a=1&&b=2");
    expectRejected("/api?a");
    expectRejected("/api?=1");
  });

  it("rejects raw plus and raw reserved query characters", () => {
    expectRejected("/api?q=a+b");
    expectRejected("/api?q=a:b");
    expectRejected("/api?q=a@b");
  });

  it("rejects duplicate decoded query keys, including encoded aliases when reachable", () => {
    expectRejected("/api?a=1&a=2");
    // %61 is non-canonical (encoded unreserved); still rejected.
    expectRejected("/api?a=1&%61=2");
  });

  it("rejects non-NFC Unicode", () => {
    // Raw e + percent-encoded combining acute is NFD; NFC would be %C3%A9.
    expectRejected("/cafe%CC%81");
    expectRejected("/x?q=e%CC%81");
  });

  it("maps invalid UTF-16 to the sanitized contract error", () => {
    expectRejected(`/x/${String.fromCharCode(0xd800)}`);
  });

  it("enforces the 1..4096 UTF-16 length bound", () => {
    expectRejected("");
    expectRejected(`/${"a".repeat(4096)}`);
    const max = `/${"a".repeat(4095)}`;
    expect(max.length).toBe(4096);
    expect(canonicalizeInternalRequestTarget(max)).toBe(max);
  });

  it("does not include the rejected target in the error message", () => {
    const secret = "/api?token=super-secret-value&a";
    expectRejected(secret);
  });
});
