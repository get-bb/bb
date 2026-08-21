import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { resolveComposeProjectId } from "./compose-project-selection";

describe("resolveComposeProjectId", () => {
  it("prefers the route param, then the stored project, then personal", () => {
    expect(
      resolveComposeProjectId({
        requestedProjectId: "proj_a",
        storedProjectId: "proj_b",
        knownProjectIds: undefined,
      }),
    ).toBe("proj_a");
    expect(
      resolveComposeProjectId({
        requestedProjectId: undefined,
        storedProjectId: "proj_b",
        knownProjectIds: undefined,
      }),
    ).toBe("proj_b");
    expect(
      resolveComposeProjectId({
        requestedProjectId: "  ",
        storedProjectId: "",
        knownProjectIds: undefined,
      }),
    ).toBe(PERSONAL_PROJECT_ID);
  });

  it("skips ids the loaded project list does not contain (deleted project) but always accepts personal", () => {
    const known = new Set(["proj_b"]);
    expect(
      resolveComposeProjectId({
        requestedProjectId: "proj_gone",
        storedProjectId: "proj_b",
        knownProjectIds: known,
      }),
    ).toBe("proj_b");
    expect(
      resolveComposeProjectId({
        requestedProjectId: "proj_gone",
        storedProjectId: "proj_also_gone",
        knownProjectIds: known,
      }),
    ).toBe(PERSONAL_PROJECT_ID);
    expect(
      resolveComposeProjectId({
        requestedProjectId: PERSONAL_PROJECT_ID,
        storedProjectId: "proj_b",
        knownProjectIds: known,
      }),
    ).toBe(PERSONAL_PROJECT_ID);
  });
});
