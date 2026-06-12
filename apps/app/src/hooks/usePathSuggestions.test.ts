import type { WorkspacePathEntry } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildPathSuggestions } from "./usePathSuggestions";

interface PathEntryFixture {
  kind?: WorkspacePathEntry["kind"];
  path: string;
  score: number;
}

function makePathEntry(fixture: PathEntryFixture): WorkspacePathEntry {
  const name = fixture.path.split("/").at(-1) ?? fixture.path;
  return {
    kind: fixture.kind ?? "file",
    path: fixture.path,
    name,
    score: fixture.score,
    positions: [],
  };
}

describe("buildPathSuggestions", () => {
  it("preserves backend order instead of alphabetizing equal-score paths", () => {
    const suggestions = buildPathSuggestions({
      workspacePaths: [
        makePathEntry({ path: "README.md", score: 100 }),
        makePathEntry({ path: "APPS/DESKTOP/README.md", score: 100 }),
        makePathEntry({ path: "PACKAGES/DB/README.md", score: 100 }),
      ],
      threadStoragePaths: [],
      limit: 8,
    });

    expect(suggestions.map((suggestion) => suggestion.path)).toEqual([
      "README.md",
      "APPS/DESKTOP/README.md",
      "PACKAGES/DB/README.md",
    ]);
  });

  it("keeps workspace paths before thread-storage paths when scores tie", () => {
    const suggestions = buildPathSuggestions({
      workspacePaths: [
        makePathEntry({ path: "packages/db/README.md", score: 100 }),
      ],
      threadStoragePaths: [makePathEntry({ path: "README.md", score: 100 })],
      limit: 8,
    });

    expect(
      suggestions.map((suggestion) => ({
        source: suggestion.source,
        path: suggestion.path,
      })),
    ).toEqual([
      { source: "workspace", path: "packages/db/README.md" },
      { source: "thread-storage", path: "README.md" },
    ]);
  });
});
