import { describe, expect, it } from "vitest";
import { projectNamesByRepo, sortByProjectName } from "./project-order";

const REPOS = [
  { repo: "acme/widgets", projectName: "Widgets" },
  { repo: "acme/site", projectName: "  bb  " },
  { repo: "acme/legacy", projectName: null },
  { repo: "acme/blank", projectName: "" },
];

function item(repo: string, number: number) {
  return { repo, number };
}

describe("project-order", () => {
  it("resolves only repos that have a usable project name", () => {
    const names = projectNamesByRepo(REPOS);
    expect(names.get("acme/widgets")).toBe("Widgets");
    // Trimmed, so a padded name still sorts and renders next to its peers.
    expect(names.get("acme/site")).toBe("bb");
    // A repo without a project and a repo with a blank name are both misses,
    // so the callers have one "no project" case instead of two.
    expect(names.has("acme/legacy")).toBe(false);
    expect(names.has("acme/blank")).toBe(false);
  });

  it("groups items by project name and pushes project-less repos last", () => {
    const ordered = sortByProjectName(
      [
        item("acme/legacy", 1),
        item("acme/widgets", 2),
        item("acme/site", 3),
        item("acme/blank", 4),
      ],
      REPOS,
    );
    expect(ordered.map((entry) => entry.number)).toEqual([3, 2, 1, 4]);
  });

  it("keeps the incoming order inside one project", () => {
    // Two repos of the same project, interleaved by update time: the sort must
    // not reshuffle them, because that order is the cache's newest-first.
    const repos = [
      { repo: "acme/api", projectName: "Platform" },
      { repo: "acme/web", projectName: "Platform" },
    ];
    const ordered = sortByProjectName(
      [item("acme/web", 1), item("acme/api", 2), item("acme/web", 3)],
      repos,
    );
    expect(ordered).toEqual([
      item("acme/web", 1),
      item("acme/api", 2),
      item("acme/web", 3),
    ]);
  });

  it("orders project names case-insensitively without splitting a project", () => {
    const repos = [
      { repo: "acme/zebra", projectName: "apollo" },
      { repo: "acme/alpha", projectName: "Borealis" },
      { repo: "acme/other", projectName: "APOLLO" },
    ];
    const ordered = sortByProjectName(
      [item("acme/alpha", 1), item("acme/other", 2), item("acme/zebra", 3)],
      repos,
    );
    // "apollo"/"APOLLO" both precede "Borealis", and the two casings stay
    // grouped rather than interleaving with it.
    expect(ordered.map((entry) => entry.repo)).toEqual([
      "acme/other",
      "acme/zebra",
      "acme/alpha",
    ]);
  });

  it("treats a repo missing from the tracked list as project-less", () => {
    const ordered = sortByProjectName(
      [item("acme/unknown", 1), item("acme/widgets", 2)],
      REPOS,
    );
    expect(ordered.map((entry) => entry.number)).toEqual([2, 1]);
  });

  it("does not mutate the caller's array", () => {
    const items = [item("acme/legacy", 1), item("acme/widgets", 2)];
    sortByProjectName(items, REPOS);
    expect(items.map((entry) => entry.number)).toEqual([1, 2]);
  });
});
