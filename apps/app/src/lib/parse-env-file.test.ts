import { expect, it } from "vitest";
import { parseEnvFile } from "./parse-env-file";

it("parses quotes after escaped backslashes and literal single-quoted backslashes", () => {
  expect(
    parseEnvFile(String.raw`DOUBLE="path\\"
SINGLE='path\'
ESCAPED="say \"hello\""`),
  ).toEqual({
    entries: [
      { name: "DOUBLE", value: "path\\" },
      { name: "SINGLE", value: "path\\" },
      { name: "ESCAPED", value: 'say "hello"' },
    ],
    errors: [],
  });
});

it("retains multiline values and reports malformed quoted assignments", () => {
  expect(parseEnvFile('MULTI="first\nsecond" # note\nEMPTY=')).toEqual({
    entries: [
      { name: "MULTI", value: "first\nsecond" },
      { name: "EMPTY", value: "" },
    ],
    errors: [],
  });
  expect(parseEnvFile('BROKEN="value" trailing').errors).toEqual([
    "Line 1: unexpected text after closing quote.",
  ]);
  expect(parseEnvFile('BROKEN="value\nnext').errors).toEqual([
    'Line 1: unterminated " quote.',
  ]);
});
