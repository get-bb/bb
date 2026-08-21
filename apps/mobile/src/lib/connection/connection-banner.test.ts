import { describe, expect, it } from "vitest";
import {
  CONNECTING_BANNER_GRACE_MS,
  deriveConnectionBanner,
  type ConnectionBannerInput,
} from "./connection-banner";

const base: ConnectionBannerInput = {
  session: { status: "idle" },
  realtime: "connected",
  suspended: false,
  connectingForMs: 0,
};

describe("deriveConnectionBanner", () => {
  it("is hidden when connected, in the background, or during the initial grace period", () => {
    expect(deriveConnectionBanner(base)).toBe("hidden");
    expect(
      deriveConnectionBanner({
        ...base,
        realtime: "reconnecting",
        suspended: true,
      }),
    ).toBe("hidden");
    expect(
      deriveConnectionBanner({
        ...base,
        realtime: "connecting",
        connectingForMs: CONNECTING_BANNER_GRACE_MS - 1,
      }),
    ).toBe("hidden");
    expect(
      deriveConnectionBanner({
        ...base,
        realtime: "connecting",
        connectingForMs: CONNECTING_BANNER_GRACE_MS,
      }),
    ).toBe("connecting");
  });

  it("reports a dropped socket as reconnecting regardless of the grace period", () => {
    expect(deriveConnectionBanner({ ...base, realtime: "reconnecting" })).toBe(
      "reconnecting",
    );
  });

  it("lets connect-mode auth problems win over the socket state", () => {
    expect(
      deriveConnectionBanner({
        ...base,
        realtime: "reconnecting",
        session: { status: "auth-required", detail: "revoked" },
      }),
    ).toBe("auth-required");
    expect(
      deriveConnectionBanner({
        ...base,
        session: { status: "error", detail: "offline", retryAt: 1 },
      }),
    ).toBe("auth-error");
  });

  it("does not flash during the hourly renewal while the socket is up", () => {
    expect(
      deriveConnectionBanner({
        ...base,
        session: { status: "authenticating" },
      }),
    ).toBe("hidden");
    expect(
      deriveConnectionBanner({
        ...base,
        session: { status: "authenticating" },
        realtime: "connecting",
        connectingForMs: CONNECTING_BANNER_GRACE_MS,
      }),
    ).toBe("connecting");
  });
});
