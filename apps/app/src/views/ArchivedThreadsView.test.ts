import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildArchivedThreadViewFilters } from "./ArchivedThreadsView";

describe("buildArchivedThreadViewFilters", () => {
  it("keeps personal archived threads project-scoped in project mode", () => {
    expect(
      buildArchivedThreadViewFilters({
        folderId: undefined,
        projectId: PERSONAL_PROJECT_ID,
        sidebarOrganizationMode: "project",
      }),
    ).toEqual({ projectId: PERSONAL_PROJECT_ID });
  });

  it("uses global unfiled archived scope in folders mode", () => {
    expect(
      buildArchivedThreadViewFilters({
        folderId: undefined,
        projectId: PERSONAL_PROJECT_ID,
        sidebarOrganizationMode: "chronological",
      }),
    ).toEqual({ projectId: undefined, unfiled: true });
  });

  it("uses folder scope regardless of sidebar organization mode", () => {
    expect(
      buildArchivedThreadViewFilters({
        folderId: "fld_work",
        projectId: PERSONAL_PROJECT_ID,
        sidebarOrganizationMode: "project",
      }),
    ).toEqual({ folderId: "fld_work", projectId: undefined });
  });
});
