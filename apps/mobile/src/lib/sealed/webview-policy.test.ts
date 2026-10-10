import { describe, expect, it } from "vitest";
import { pageMustSeal, webViewSealedVerdict } from "./webview-policy";

describe("webViewSealedVerdict", () => {
  it("holds the web view until the native transport has decided the policy", () => {
    expect(webViewSealedVerdict({ kind: "idle" })).toBe("wait");
    expect(webViewSealedVerdict({ kind: "probing" })).toBe("wait");
  });

  it("blocks the web view when the server offers no sealed endpoint until the owner accepts", () => {
    expect(
      webViewSealedVerdict({ kind: "plaintext", reason: "x", accepted: false }),
    ).toBe("blocked");
    expect(
      webViewSealedVerdict({ kind: "plaintext", reason: "x", accepted: true }),
    ).toBe("allow");
  });

  it("blocks the web view when the probe failed before any key was pinned", () => {
    expect(
      webViewSealedVerdict({ kind: "offline", error: "x", fingerprint: null }),
    ).toBe("blocked");
    expect(
      webViewSealedVerdict({ kind: "offline", error: "x", fingerprint: "F" }),
    ).toBe("allow");
  });

  it("lets sealed states through and tells the page to seal", () => {
    const ready = {
      kind: "ready" as const,
      fingerprint: "F",
      verified: true,
      acknowledged: true,
      deviceId: "dev_1",
    };
    expect(webViewSealedVerdict(ready)).toBe("allow");
    expect(
      webViewSealedVerdict({ ...ready, verified: false, acknowledged: false }),
    ).toBe("blocked");
    expect(
      webViewSealedVerdict({ ...ready, verified: false, acknowledged: true }),
    ).toBe("allow");
    expect(pageMustSeal(ready)).toBe(true);
    expect(
      webViewSealedVerdict({
        kind: "pending",
        fingerprint: "F",
        deviceId: "dev_1",
      }),
    ).toBe("allow");
    expect(
      pageMustSeal({ kind: "plaintext", reason: "x", accepted: true }),
    ).toBe(false);
    expect(pageMustSeal(null)).toBe(false);
  });
});
