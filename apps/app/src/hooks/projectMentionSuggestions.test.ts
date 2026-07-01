import { describe, expect, it } from "vitest";
import {
  buildProjectMentionSuggestions,
  type ProjectMentionCandidate,
} from "./projectMentionSuggestions";

const PROJECTS: ProjectMentionCandidate[] = [
  { id: "proj_alpha", name: "Alpha Service" },
  { id: "proj_beta", name: "Beta Dashboard" },
  { id: "proj_personal", name: "Personal" },
];

describe("buildProjectMentionSuggestions", () => {
  it("returns nothing for an empty query", () => {
    expect(
      buildProjectMentionSuggestions({
        projects: PROJECTS,
        query: "   ",
        limit: 8,
      }),
    ).toEqual([]);
  });

  it("fuzzy-matches by project name and serializes a project reference", () => {
    const suggestions = buildProjectMentionSuggestions({
      projects: PROJECTS,
      query: "alpha",
      limit: 8,
    });

    expect(suggestions).toEqual([
      {
        kind: "project",
        path: "project:proj_alpha",
        replacement: "project:proj_alpha",
        projectId: "proj_alpha",
        name: "Alpha Service",
      },
    ]);
  });

  it("matches by project id", () => {
    const suggestions = buildProjectMentionSuggestions({
      projects: PROJECTS,
      query: "proj_beta",
      limit: 8,
    });

    expect(suggestions.map((suggestion) => suggestion.projectId)).toEqual([
      "proj_beta",
    ]);
  });

  it("honors the limit", () => {
    const suggestions = buildProjectMentionSuggestions({
      projects: PROJECTS,
      query: "e",
      limit: 1,
    });

    expect(suggestions.length).toBe(1);
  });

  it("falls back to the id when a project has no name", () => {
    const suggestions = buildProjectMentionSuggestions({
      projects: [{ id: "proj_nameless", name: "  " }],
      query: "proj_nameless",
      limit: 8,
    });

    expect(suggestions[0]?.name).toBe("proj_nameless");
  });
});
