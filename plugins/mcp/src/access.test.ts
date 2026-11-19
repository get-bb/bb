import { describe, expect, it } from "vitest";
import { mcpAccessProblem, type McpRequestAccess } from "./access.js";

function problem(access: McpRequestAccess, headers: Record<string, string>) {
  return mcpAccessProblem(new Headers(headers), access);
}

describe("mcpAccessProblem", () => {
  it.each(["server-machine", "signed-in-device"] as const)(
    "lets a %s caller that is not a web page through",
    (access) => {
      expect(problem(access, {})).toBeNull();
      expect(problem(access, { origin: "https://evil.example" })).toMatchObject(
        { status: 403 },
      );
    },
  );

  it("refuses a caller core could not authenticate, even with forged gate headers", () => {
    expect(
      problem("anonymous", { "x-bb-gate-oauth-scope": "bb" }),
    ).toMatchObject({ status: 401 });
  });

  it.each(["connect-session", "machine"] as const)(
    "refuses a %s caller that is not an OAuth client",
    (access) => {
      expect(problem(access, { "x-bb-gate-oauth-scope": "bb" })).toMatchObject({
        status: 403,
      });
    },
  );

  it("lets an OAuth client with the bb scope through and refuses one without", () => {
    expect(problem("oauth", { "x-bb-gate-oauth-scope": "bb" })).toBeNull();
    expect(
      problem("oauth", { "x-bb-gate-oauth-scope": "openid bb" }),
    ).toBeNull();
    for (const scope of ["", "openid", "bbx", "bb:all"]) {
      expect(
        problem("oauth", { "x-bb-gate-oauth-scope": scope }),
      ).toMatchObject({ status: 403 });
    }
  });
});
