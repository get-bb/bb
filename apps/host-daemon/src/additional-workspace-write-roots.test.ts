import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_WORKSPACE_WRITE_ROOTS_ENV,
  loadAdditionalWorkspaceWriteRoots,
  parseAdditionalWorkspaceWriteRoots,
} from "./additional-workspace-write-roots.js";

describe("additional workspace write roots", () => {
  it("parses, trims, and deduplicates the host path list", () => {
    expect(
      parseAdditionalWorkspaceWriteRoots(
        [` /first/cache `, "/second/state", "/first/cache", ""].join(delimiter),
      ),
    ).toEqual(["/first/cache", "/second/state"]);
  });

  it("defaults to no additional roots", () => {
    expect(loadAdditionalWorkspaceWriteRoots({})).toEqual([]);
  });

  it("rejects relative roots before a runtime starts", () => {
    expect(() =>
      loadAdditionalWorkspaceWriteRoots({
        [ADDITIONAL_WORKSPACE_WRITE_ROOTS_ENV]: [
          "/absolute/cache",
          "relative/cache",
        ].join(delimiter),
      }),
    ).toThrow(
      `${ADDITIONAL_WORKSPACE_WRITE_ROOTS_ENV} entries must be absolute paths: relative/cache`,
    );
  });
});
