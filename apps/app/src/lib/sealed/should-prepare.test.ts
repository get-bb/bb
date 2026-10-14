import { describe, expect, it } from "vitest";
import { shouldPrepareSealedTransport } from "./should-prepare";

function env(
  overrides: Partial<Parameters<typeof shouldPrepareSealedTransport>[0]>,
) {
  return {
    location: {
      protocol: "https:",
      hostname: "sawyer.getbb.app",
      origin: "https://sawyer.getbb.app",
    },
    storage: { getItem: () => null },
    ...overrides,
  };
}

describe("shouldPrepareSealedTransport", () => {
  it("skips loopback origins with no pinned key", () => {
    expect(
      shouldPrepareSealedTransport(
        env({
          location: {
            protocol: "http:",
            hostname: "localhost",
            origin: "http://localhost:38886",
          },
        }),
      ),
    ).toBe(false);
  });

  it("prepares on remote origins and on any origin with a pinned key", () => {
    expect(shouldPrepareSealedTransport(env({}))).toBe(true);
    expect(
      shouldPrepareSealedTransport(
        env({
          location: {
            protocol: "http:",
            hostname: "localhost",
            origin: "http://localhost:38886",
          },
          storage: {
            getItem: (key) =>
              key.endsWith("http://localhost:38886") ? "{}" : null,
          },
        }),
      ),
    ).toBe(true);
  });

  it("never prepares outside http(s) pages", () => {
    expect(
      shouldPrepareSealedTransport(
        env({ location: { protocol: "file:", hostname: "", origin: "null" } }),
      ),
    ).toBe(false);
    expect(shouldPrepareSealedTransport(env({ location: null }))).toBe(false);
  });
});
