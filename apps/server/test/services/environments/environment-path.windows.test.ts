// bb-fork(windows): Windows absolute host paths must pass path-claim
// validation during environment provisioning.
import { describe, expect, it } from "vitest";
import { parseClaimableEnvironmentPath } from "../../../src/services/environments/environment-path.windows.js";

describe("parseClaimableEnvironmentPath", () => {
  it.each([
    "/tmp/project",
    "C:\\Users\\tester\\project",
    "c:/Users/tester/project",
    "\\\\server\\share\\project",
  ])("accepts host-absolute path %s", (path) => {
    expect(parseClaimableEnvironmentPath(path)).toBe(path);
  });

  it.each(["project", "C:relative", "../project", "", "tmp/project"])(
    "rejects non-absolute path %s",
    (path) => {
      expect(() => parseClaimableEnvironmentPath(path)).toThrow();
    },
  );

  it("rejects paths containing NUL bytes", () => {
    expect(() => parseClaimableEnvironmentPath("C:\\proj\0ect")).toThrow();
  });
});
