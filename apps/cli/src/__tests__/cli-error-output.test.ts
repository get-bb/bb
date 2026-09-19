import { describe, expect, it } from "vitest";
import { isJsonInvocation, toCliErrorEnvelope } from "../cli-error-output.js";

describe("isJsonInvocation", () => {
  const cases: Array<[string[], boolean]> = [
    [["thread", "list", "--json"], true],
    [["thread", "log", "thr_1", "--format", "json"], true],
    [["thread", "log", "thr_1", "--format=json"], true],
    [["thread", "log", "thr_1", "--format", "minimal"], false],
    [["terminal", "create", "--thread", "thr_1", "--", "jq", "--json"], false],
    [["thread", "tell", "thr_1", "please use --json"], false],
  ];
  it.each(cases)("%j → %s", (args, expected) => {
    expect(isJsonInvocation(["node", "bb", ...args])).toBe(expected);
  });
});

describe("toCliErrorEnvelope", () => {
  it("omits hint when there is none", () => {
    expect(
      toCliErrorEnvelope({ code: "error", hint: null, message: "boom" }),
    ).toEqual({ ok: false, error: { code: "error", message: "boom" } });
  });

  it("carries the hint when bb knows the fix", () => {
    expect(
      toCliErrorEnvelope({
        code: "missing_required",
        hint: "add --project proj_1",
        message: "required option '--project <id>' not specified",
      }).error.hint,
    ).toBe("add --project proj_1");
  });
});
