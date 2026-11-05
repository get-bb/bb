import { describe, expect, it } from "vitest";
import { serverCredentialFromHeaders } from "../src/index.js";

describe("serverCredentialFromHeaders", () => {
  it("reads either the bearer token or the machine header", () => {
    expect(
      serverCredentialFromHeaders(
        new Headers({ authorization: "Bearer bbcred_a" }),
      ),
    ).toBe("bbcred_a");
    expect(
      serverCredentialFromHeaders(
        new Headers({ "x-bb-connect-machine": "bbcred_b" }),
      ),
    ).toBe("bbcred_b");
    expect(
      serverCredentialFromHeaders(
        new Headers({
          authorization: "Bearer bbcred_a",
          "x-bb-connect-machine": "bbcred_a",
        }),
      ),
    ).toBe("bbcred_a");
    expect(
      serverCredentialFromHeaders(new Headers({ authorization: "Basic abc" })),
    ).toBe("");
    expect(serverCredentialFromHeaders(new Headers())).toBe("");
  });
});
