import type { DiffFileEntry } from "bb-plugin-bb--git/contract";

export function makeDiffFileEntry(
  overrides: Partial<DiffFileEntry> = {},
): DiffFileEntry {
  return {
    path: "src/file.ts",
    previousPath: null,
    changeKind: "modified",
    additions: 0,
    deletions: 0,
    binary: false,
    origin: "tracked",
    loadMode: "auto",
    revision: "100644:aaaa:100644:bbbb",
    ...overrides,
  };
}
