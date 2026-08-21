import { ConnectListError } from "@bb/connect-client";
import { BbHttpError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import { mapAuthError } from "./auth-error";

function response(status: number, contentType: string) {
  return {
    status,
    headers: {
      get: (n: string) => (n === "content-type" ? contentType : null),
    },
  };
}

describe("mapAuthError", () => {
  it("treats the gate's HTML 401/403 and revoked credentials as auth-required", () => {
    expect(mapAuthError(response(401, "text/html; charset=utf-8"))).toBe(
      "auth-required",
    );
    expect(mapAuthError(response(403, "text/plain"))).toBe("auth-required");
    expect(mapAuthError(new ConnectListError("unauthorized", "nope"))).toBe(
      "auth-required",
    );
    expect(
      mapAuthError(
        new BbHttpError({
          status: 401,
          message: "Unauthorized",
          body: null,
          code: null,
        }),
      ),
    ).toBe("auth-required");
  });

  it("separates transport failures from other server errors", () => {
    expect(mapAuthError(new ConnectListError("network", "boom"))).toBe(
      "network",
    );
    expect(mapAuthError(new TypeError("Network request failed"))).toBe(
      "network",
    );
    expect(
      mapAuthError(Object.assign(new Error("aborted"), { name: "AbortError" })),
    ).toBe("network");
    expect(mapAuthError(response(503, "text/html"))).toBe("http");
    expect(
      mapAuthError(
        new BbHttpError({
          status: 500,
          message: "oops",
          body: null,
          code: null,
        }),
      ),
    ).toBe("http");
    expect(mapAuthError(new Error("weird"))).toBe("unknown");
    expect(mapAuthError(response(200, "application/json"))).toBe("unknown");
  });
});
