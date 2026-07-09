import { describe, expect, it } from "vitest";
import { parse } from "dotenv";
import { assertNoDuplicateAssignments, reconcileDotenv } from "./dotenv.js";

describe("dotenv reconciliation", () => {
  it("updates requested assignments and preserves unrelated bytes and CRLF", () => {
    const source =
      "# config\r\nexport API_KEY = old # keep this\r\nOTHER=value\r\n";
    const result = reconcileDotenv(source, {
      API_KEY: "new secret",
      TOKEN: "tok\\en",
    });

    expect(result).toEqual({
      content:
        "# config\r\nexport API_KEY = 'new secret' # keep this\r\nOTHER=value\r\nTOKEN='tok\\en'\r\n",
      added: 1,
      updated: 1,
      unchanged: 0,
    });
    expect(parse(result.content)).toMatchObject({
      API_KEY: "new secret",
      TOKEN: "tok\\en",
    });
  });

  it("round-trips quote and backslash combinations through dotenv", () => {
    const values = {
      SINGLE: "it's secret",
      BOTH: `both ' and " quotes`,
      SLASH_N: String.raw`it's\\not-a-newline`,
    };
    const result = reconcileDotenv("", values);
    expect(parse(result.content)).toEqual(values);
  });

  it("rejects duplicate active assignments before collecting secrets", () => {
    expect(() =>
      assertNoDuplicateAssignments("API_KEY=one\nexport API_KEY=two\n", [
        "API_KEY",
      ]),
    ).toThrow("duplicate assignments for API_KEY");
  });
});
