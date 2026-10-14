import { describe, expect, it } from "vitest";
import { mcpAccessProblem } from "./access.js";

function problem(headers: Record<string, string>) {
  return mcpAccessProblem(new Headers(headers));
}

describe("mcpAccessProblem", () => {
  it("lets a local caller with no gate headers through", () => {
    expect(problem({})).toBeNull();
  });

  it("refuses a local request that comes from a web page", () => {
    expect(problem({ origin: "https://evil.example" })).toMatchObject({
      status: 403,
    });
    expect(problem({ origin: "http://127.0.0.1:38886" })).toMatchObject({
      status: 403,
    });
  });

  it.each(["session", "machine", "", "OAuth"])(
    "refuses a gate request authenticated as %j",
    (kind) => {
      expect(
        problem({ "x-bb-gate-auth": kind, "x-bb-gate-oauth-scope": "bb" }),
      ).toMatchObject({ status: 403 });
    },
  );

  it("lets a gate request with an OAuth token for bb through", () => {
    expect(
      problem({ "x-bb-gate-auth": "oauth", "x-bb-gate-oauth-scope": "bb" }),
    ).toBeNull();
    expect(
      problem({
        "x-bb-gate-auth": "oauth",
        "x-bb-gate-oauth-scope": "openid bb",
      }),
    ).toBeNull();
  });

  it("refuses an OAuth request without the bb scope", () => {
    for (const scope of ["", "openid", "bbx", "bb:all"]) {
      expect(
        problem({ "x-bb-gate-auth": "oauth", "x-bb-gate-oauth-scope": scope }),
      ).toMatchObject({ status: 403 });
    }
  });
});
