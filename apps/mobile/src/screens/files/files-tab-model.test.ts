import { describe, expect, it } from "vitest";
import { buildFilesTabRows } from "./files-tab-model";

const storageIdle = {
  directoryPath: "",
  entries: [],
  loaded: true,
  isLoading: false,
  isError: false,
};
const searchIdle = {
  sections: [],
  isLoading: false,
  isError: false,
  isUnavailable: false,
};

describe("buildFilesTabRows", () => {
  it("shows grouped search results while a query is typed", () => {
    const rows = buildFilesTabRows({
      hasQuery: true,
      search: {
        ...searchIdle,
        sections: [
          {
            source: "workspace",
            title: "Workspace files",
            truncated: true,
            results: [
              {
                source: "workspace",
                path: "a.ts",
                name: "a.ts",
                score: 1,
                positions: [0],
              },
            ],
          },
        ],
      },
      recent: {
        items: [{ source: "workspace", path: "x", openedAt: 1 }],
        expanded: false,
      },
      storage: storageIdle,
    });
    expect(rows.map((row) => row.kind)).toEqual(["section", "search-result"]);
    expect(rows[0]).toMatchObject({ note: "Showing the best matches" });
  });

  it("reports loading / empty / unavailable search states", () => {
    expect(
      buildFilesTabRows({
        hasQuery: true,
        search: { ...searchIdle, isLoading: true },
        recent: { items: [], expanded: false },
        storage: storageIdle,
      })[0],
    ).toMatchObject({ kind: "search-state", state: "loading" });
    expect(
      buildFilesTabRows({
        hasQuery: true,
        search: searchIdle,
        recent: { items: [], expanded: false },
        storage: storageIdle,
      })[0],
    ).toMatchObject({ kind: "search-state", state: "empty" });
    expect(
      buildFilesTabRows({
        hasQuery: true,
        search: { ...searchIdle, isUnavailable: true },
        recent: { items: [], expanded: false },
        storage: storageIdle,
      }),
    ).toEqual([
      { kind: "search-state", key: "search:unavailable", state: "unavailable" },
    ]);
  });

  it("caps recents at the visible limit with a toggle, then the storage browser", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      source: "workspace" as const,
      path: `f${index}.ts`,
      openedAt: index,
    }));
    const rows = buildFilesTabRows({
      hasQuery: false,
      search: searchIdle,
      recent: { items, expanded: false },
      storage: {
        ...storageIdle,
        directoryPath: "docs",
        entries: [
          { kind: "directory", path: "docs/img", name: "img", fileCount: 2 },
          { kind: "file", path: "docs/a.md", name: "a.md" },
        ],
      },
    });
    const kinds = rows.map((row) => row.kind);
    expect(kinds.filter((kind) => kind === "recent")).toHaveLength(6);
    expect(rows.find((row) => row.kind === "recent-toggle")).toMatchObject({
      hidden: 2,
      expanded: false,
    });
    expect(kinds.slice(-4)).toEqual([
      "section",
      "storage-breadcrumbs",
      "storage-entry",
      "storage-entry",
    ]);
  });

  it("shows storage loading / empty states instead of entries", () => {
    const loading = buildFilesTabRows({
      hasQuery: false,
      search: searchIdle,
      recent: { items: [], expanded: false },
      storage: { ...storageIdle, loaded: false, isLoading: true },
    });
    expect(loading.at(-1)).toMatchObject({
      kind: "storage-state",
      state: "loading",
    });
    const empty = buildFilesTabRows({
      hasQuery: false,
      search: searchIdle,
      recent: { items: [], expanded: false },
      storage: storageIdle,
    });
    expect(empty.at(-1)).toMatchObject({
      kind: "storage-state",
      state: "empty",
    });
    expect(empty[0]).toMatchObject({
      kind: "section",
      title: "Thread storage",
    });
  });
});

describe("buildFilesTabRows without a thread", () => {
  it("shows only a hint when idle and search results when typing", () => {
    expect(
      buildFilesTabRows({
        hasQuery: false,
        search: searchIdle,
        recent: { items: [], expanded: false },
        storage: null,
      }),
    ).toEqual([{ kind: "search-state", key: "search:hint", state: "hint" }]);
  });
});
