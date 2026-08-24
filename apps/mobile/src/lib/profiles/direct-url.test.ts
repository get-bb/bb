import { describe, expect, it } from "vitest";
import { validateDirectServerUrl } from "./direct-url";

describe("validateDirectServerUrl", () => {
  it("accepts https to any host without a warning", () => {
    expect(validateDirectServerUrl("https://mac.tail1234.ts.net/")).toEqual({
      ok: true,
      serverUrl: "https://mac.tail1234.ts.net",
      warning: null,
    });
  });

  it("accepts loopback http without a warning (simulator/emulator)", () => {
    expect(validateDirectServerUrl("http://127.0.0.1:20304")).toEqual({
      ok: true,
      serverUrl: "http://127.0.0.1:20304",
      warning: null,
    });
    expect(validateDirectServerUrl("http://localhost:1234")).toMatchObject({
      ok: true,
      warning: null,
    });
  });

  it("warns for http to LAN / Tailscale IPs, .local names, and bare hostnames", () => {
    for (const url of [
      "http://192.168.1.20:38886",
      "http://10.0.2.2:38886",
      "http://100.101.102.103:38886",
      "http://studio.local:38886",
      "http://studio:38886",
      "http://[fd7a::1]:38886",
    ]) {
      expect(validateDirectServerUrl(url), url).toMatchObject({
        ok: true,
        warning: "insecure-http",
      });
    }
  });

  it("rejects http to a domain name (ATS blocks it; users need the https URL)", () => {
    expect(validateDirectServerUrl("http://mac.tail1234.ts.net")).toMatchObject(
      {
        ok: false,
        code: "http-domain",
      },
    );
  });

  it("rejects non-http schemes and schemeless input", () => {
    expect(validateDirectServerUrl("ftp://host")).toMatchObject({
      ok: false,
      code: "unsupported-scheme",
    });
    expect(validateDirectServerUrl("bb://host")).toMatchObject({
      ok: false,
      code: "unsupported-scheme",
    });
    expect(validateDirectServerUrl("192.168.1.20:38886")).toMatchObject({
      ok: false,
      code: "missing-scheme",
    });
    expect(validateDirectServerUrl("   ")).toMatchObject({
      ok: false,
      code: "empty",
    });
    expect(validateDirectServerUrl("http://")).toMatchObject({
      ok: false,
      code: "invalid-url",
    });
  });

  it("normalizes: trims, drops trailing slashes/search/hash, keeps a path prefix", () => {
    expect(
      validateDirectServerUrl("  https://Host.example/bb/?x=1#y  "),
    ).toEqual({
      ok: true,
      serverUrl: "https://host.example/bb",
      warning: null,
    });
  });
});
