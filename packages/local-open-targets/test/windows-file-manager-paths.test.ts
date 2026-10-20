import { expect, it } from "vitest";
import { buildWindowsFileManagerOpenInvocation } from "../src/windows-open-targets.js";

it.each([
  {
    input: "C:/projects/review notes/draft.md",
    expected: "C:\\projects\\review notes\\draft.md",
  },
  {
    input: "//fileserver/shared/review notes/draft.md",
    expected: "\\\\fileserver\\shared\\review notes\\draft.md",
  },
  {
    input: "C:\\projects/review notes\\draft.md",
    expected: "C:\\projects\\review notes\\draft.md",
  },
  {
    input: "C:\\projects\\it's & notes.md",
    expected: "C:\\projects\\it's & notes.md",
  },
])(
  "passes a native Windows path to Explorer for $input",
  ({ input, expected }) => {
    const invocation = buildWindowsFileManagerOpenInvocation({
      env: undefined,
      existingPath: { path: input, type: "file" },
    });

    expect(invocation.env?.WORKSPACE_OPEN_TARGET_PATH).toBe(expected);
    expect(invocation.args.join(" ")).not.toContain(input);
  },
);
