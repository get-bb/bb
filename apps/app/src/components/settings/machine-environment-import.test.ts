import { expect, it } from "vitest";
import { parseMachineEnvironmentImport } from "./machine-environment-import";

it("parses comments, exports, quoted hashes and multiline values without expanding variables", () => {
  expect(
    parseMachineEnvironmentImport(
      '# comment\nexport FIRST="a#b"\nSECOND=literal # comment\nTHIRD="line\ntwo"\nFOURTH=$FIRST',
    ),
  ).toEqual([
    { name: "FIRST", value: "a#b" },
    { name: "SECOND", value: "literal" },
    { name: "THIRD", value: "line\ntwo" },
    { name: "FOURTH", value: "$FIRST" },
  ]);
});
it.each([
  "BAD NAME=value",
  'A="unterminated',
  "A=one\nA=two",
  'A="secret"junk',
  "A=\0",
])(
  "rejects malformed imports without including their values in errors",
  (input) => {
    expect(() => parseMachineEnvironmentImport(input)).toThrow();
    try {
      parseMachineEnvironmentImport(input);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  },
);

it("handles escaped quotes and backslashes in double-quoted values", () => {
  expect(parseMachineEnvironmentImport(String.raw`TOKEN="a\"b\\c"`)).toEqual([
    { name: "TOKEN", value: 'a"b\\c' },
  ]);
});
