import { expect, it } from "vitest";
import { resolveContainedPath } from "../src/index.js";

it.runIf(process.platform === "win32").each([
  {
    rootPath: "C:\\Users\\Developer\\My Project",
    candidatePath: "c:\\users\\developer\\my project\\src\\file.ts",
    expected: "c:\\users\\developer\\my project\\src\\file.ts",
  },
  {
    rootPath: "C:\\workspace",
    candidatePath: "C:\\workspace\\..\\outside\\file.ts",
    expected: null,
  },
  {
    rootPath: "C:\\workspace",
    candidatePath: "C:\\workspace-other\\file.ts",
    expected: null,
  },
  {
    rootPath: "C:\\workspace",
    candidatePath: "D:\\workspace\\file.ts",
    expected: null,
  },
  {
    rootPath: "\\\\server\\share\\workspace",
    candidatePath: "\\\\server\\share\\workspace\\src\\file.ts",
    expected: "\\\\server\\share\\workspace\\src\\file.ts",
  },
  {
    rootPath: "\\\\server\\share\\workspace",
    candidatePath: "\\\\server\\other-share\\workspace\\file.ts",
    expected: null,
  },
])("contains $candidatePath within $rootPath", ({ expected, ...args }) => {
  expect(resolveContainedPath(args)).toBe(expected);
});
