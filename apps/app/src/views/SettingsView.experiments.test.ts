import { describe, expect, it } from "vitest";
import { visibleExperimentKeys } from "./SettingsView";

describe("visibleExperimentKeys", () => {
  it("hides performance diagnostics when startup permission is absent", () => {
    expect(visibleExperimentKeys(false)).not.toContain(
      "performanceDiagnostics",
    );
    expect(visibleExperimentKeys(false)).toEqual(
      expect.arrayContaining(["changelogPreview", "serverMove"]),
    );
  });

  it("shows performance diagnostics when the server was launched with permission", () => {
    expect(visibleExperimentKeys(true)).toContain("performanceDiagnostics");
  });
});
