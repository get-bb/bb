import { describe, expect, it } from "vitest";
import {
  clientCertificateOrigin,
  shouldForgetClientCertificate,
  supportsClientCertificate,
} from "./client-certificate";
import type { ServerProfile } from "./profile";

function direct(id: string, serverUrl: string): ServerProfile {
  return { id, mode: "direct", serverUrl, label: id, createdAt: 0 };
}

describe("clientCertificateOrigin", () => {
  it.each([
    ["https://bb.example.com", "bb.example.com:443"],
    ["https://BB.Example.com/", "bb.example.com:443"],
    ["https://bb.example.com:8443/app", "bb.example.com:8443"],
    ["https://bb.example.com:443", "bb.example.com:443"],
  ])("keys %s by host and port", (serverUrl, origin) => {
    expect(clientCertificateOrigin(serverUrl)).toBe(origin);
  });

  it.each(["http://192.168.1.20:38886", "not a url"])(
    "has no origin for %s",
    (serverUrl) => {
      expect(clientCertificateOrigin(serverUrl)).toBeNull();
    },
  );
});

describe("supportsClientCertificate", () => {
  it("offers a certificate only for direct https servers", () => {
    expect(
      supportsClientCertificate(direct("a", "https://bb.example.com")),
    ).toBe(true);
    expect(
      supportsClientCertificate(direct("a", "http://192.168.1.20:38886")),
    ).toBe(false);
    expect(
      supportsClientCertificate({
        id: "c",
        mode: "connect",
        serverUrl: "https://laptop.getbb.app",
        label: "laptop",
        handle: "laptop",
        credential: "bbcm_secret",
        createdAt: 0,
      }),
    ).toBe(false);
  });
});

describe("shouldForgetClientCertificate", () => {
  const removed = direct("a", "https://bb.example.com");

  it("forgets the choice when no other server uses the origin", () => {
    expect(
      shouldForgetClientCertificate(removed, [
        removed,
        direct("b", "https://other.example.com"),
        direct("c", "https://bb.example.com:8443"),
      ]),
    ).toBe(true);
  });

  it("keeps the choice while another server uses the same origin", () => {
    expect(
      shouldForgetClientCertificate(removed, [
        removed,
        direct("b", "https://BB.example.com/"),
      ]),
    ).toBe(false);
  });

  it("has nothing to forget for an http server", () => {
    const plain = direct("a", "http://192.168.1.20:38886");
    expect(shouldForgetClientCertificate(plain, [plain])).toBe(false);
  });
});
