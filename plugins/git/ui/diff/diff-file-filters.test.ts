import { expect, it } from "vitest";
import { makeDiffFileEntry } from "./diff-file-fixtures.js";
import {
  DEFAULT_DIFF_FILE_FILTERS,
  diffExtensionCounts,
  filterDiffFiles,
} from "./diff-file-filters.js";

const files = [
  makeDiffFileEntry({ path: "src/a.ts", revision: "reviewed" }),
  makeDiffFileEntry({ path: "src/b.ts", revision: "edited" }),
  makeDiffFileEntry({ path: "src/c.ts", changeKind: "deleted" }),
  makeDiffFileEntry({ path: "docs/readme.md" }),
  makeDiffFileEntry({ path: ".gitignore" }),
  makeDiffFileEntry({ path: "Makefile" }),
];
const viewed = new Map([
  ["src/a.ts", "reviewed"],
  ["src/b.ts", "older"],
]);

it("combines filename, extension, deleted and revision-aware Viewed filters", () => {
  expect(
    filterDiffFiles(
      files,
      "src",
      {
        selectedExtensions: [".ts"],
        showDeleted: false,
        showViewed: false,
      },
      viewed,
    ).map((file) => file.path),
  ).toEqual(["src/b.ts"]);
  expect(
    filterDiffFiles(
      files,
      "",
      { ...DEFAULT_DIFF_FILE_FILTERS, selectedExtensions: [".unknown"] },
      viewed,
    ),
  ).toEqual([]);
  expect(filterDiffFiles(files, "", DEFAULT_DIFF_FILE_FILTERS, viewed)).toEqual(
    files,
  );
});

it("counts extensions across all files, including deleted files and extensionless names", () => {
  expect(diffExtensionCounts(files)).toEqual([
    ["", 2],
    [".md", 1],
    [".ts", 3],
  ]);
  expect(
    diffExtensionCounts([
      makeDiffFileEntry({ path: "renamed/new.TSX", previousPath: "old.txt" }),
      makeDiffFileEntry({ path: "test.tsx.snap" }),
    ]),
  ).toEqual([
    [".snap", 1],
    [".tsx", 1],
  ]);
});

it("selects only the chosen extensions and restores all types with an empty selection", () => {
  for (const [selectedExtensions, expected] of [
    [[".md"], ["docs/readme.md"]],
    [
      [".md", ""],
      ["docs/readme.md", ".gitignore", "Makefile"],
    ],
    [[], files.map((file) => file.path)],
  ]) {
    expect(
      filterDiffFiles(
        files,
        "",
        { ...DEFAULT_DIFF_FILE_FILTERS, selectedExtensions },
        viewed,
      ).map((file) => file.path),
    ).toEqual(expected);
  }
});
