import { describe, expect, it } from "vitest";
import {
  buildFolderMentionSuggestions,
  type FolderMentionCandidate,
} from "./folderMentionSuggestions";

const FOLDERS: FolderMentionCandidate[] = [
  { id: "fld_alpha", name: "Alpha work" },
  { id: "fld_beta", name: "Beta launch" },
];

describe("buildFolderMentionSuggestions", () => {
  it("fuzzy-matches by folder name and serializes a folder reference", () => {
    expect(
      buildFolderMentionSuggestions({
        folders: FOLDERS,
        query: "alpha",
        limit: 8,
      }),
    ).toEqual([
      {
        kind: "folder",
        path: "folder:fld_alpha",
        replacement: "folder:fld_alpha",
        folderId: "fld_alpha",
        name: "Alpha work",
      },
    ]);
  });

  it("matches by folder id", () => {
    expect(
      buildFolderMentionSuggestions({
        folders: FOLDERS,
        query: "fld_beta",
        limit: 8,
      }).map((suggestion) => suggestion.folderId),
    ).toEqual(["fld_beta"]);
  });
});
