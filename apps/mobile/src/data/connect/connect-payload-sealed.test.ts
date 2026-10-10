import { describe, expect, it } from "vitest";
import {
  parseConnectPairingPayload,
  resolveEnrollmentTarget,
} from "./connect-payload";

describe("sealed pairing payload", () => {
  it("carries the server key and device code from a scanned QR payload", () => {
    const parsed = parseConnectPairingPayload(
      JSON.stringify({
        code: "K7QP-2M4X",
        serverUrl: "https://sawyer.getbb.app",
        apex: "https://getbb.app",
        expiresAt: 1_800_000_000_000,
        sealed: {
          serverKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          fingerprint: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF",
          deviceCode: "WXYZ-2345-6789",
        },
      }),
    );
    expect(parsed?.sealed).toEqual({
      serverKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      fingerprint: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF",
      deviceCode: "WXYZ-2345-6789",
    });
    const target = resolveEnrollmentTarget({
      code: parsed!.code,
      server: parsed!.serverUrl ?? "",
      apexUrl: parsed!.apexUrl ?? "",
      sealed: parsed!.sealed,
    });
    expect(target.ok && target.sealed?.deviceCode).toBe("WXYZ-2345-6789");
  });

  it("rejects a QR payload whose encryption material is present but damaged", () => {
    expect(
      parseConnectPairingPayload(
        JSON.stringify({
          code: "K7QP-2M4X",
          serverUrl: "https://sawyer.getbb.app",
          apex: "https://getbb.app",
          expiresAt: 1_800_000_000_000,
          sealed: { serverKey: "short", fingerprint: "?", deviceCode: "x" },
        }),
      ),
    ).toBeNull();
  });

  it("leaves typed codes without encryption material", () => {
    expect(parseConnectPairingPayload("K7QP-2M4X")?.sealed).toBeNull();
  });
});
