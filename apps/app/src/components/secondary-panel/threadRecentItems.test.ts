import { describe, expect, it } from "vitest";
import {
  recordRecentItem,
  resolveRecentFileKind,
  type ThreadRecentItem,
} from "./threadRecentItems";

describe("recordRecentItem", () => {
  it("prepends a newly opened item so the list reads newest-first", () => {
    const items: ThreadRecentItem[] = [
      { source: "workspace", path: "src/a.ts", openedAt: 10 },
    ];
    const next = recordRecentItem({
      items,
      source: "thread-storage",
      path: "plans/b.md",
      openedAt: 20,
    });
    expect(next).toEqual([
      { source: "thread-storage", path: "plans/b.md", openedAt: 20 },
      { source: "workspace", path: "src/a.ts", openedAt: 10 },
    ]);
  });

  it("dedupes by source+path, moving the reopened item to the front with a fresh time", () => {
    const items: ThreadRecentItem[] = [
      { source: "workspace", path: "src/a.ts", openedAt: 10 },
      { source: "thread-storage", path: "plans/b.md", openedAt: 20 },
    ];
    const next = recordRecentItem({
      items,
      source: "workspace",
      path: "src/a.ts",
      openedAt: 30,
    });
    expect(next).toEqual([
      { source: "workspace", path: "src/a.ts", openedAt: 30 },
      { source: "thread-storage", path: "plans/b.md", openedAt: 20 },
    ]);
  });

  it("treats the same path under different sources as distinct items", () => {
    const items: ThreadRecentItem[] = [
      { source: "workspace", path: "notes.md", openedAt: 10 },
    ];
    const next = recordRecentItem({
      items,
      source: "thread-storage",
      path: "notes.md",
      openedAt: 20,
    });
    expect(next).toHaveLength(2);
  });

  it("caps the list to the limit, dropping the oldest", () => {
    const items: ThreadRecentItem[] = [
      { source: "workspace", path: "a", openedAt: 3 },
      { source: "workspace", path: "b", openedAt: 2 },
      { source: "workspace", path: "c", openedAt: 1 },
    ];
    const next = recordRecentItem({
      items,
      source: "workspace",
      path: "d",
      openedAt: 4,
      limit: 3,
    });
    expect(next.map((item) => item.path)).toEqual(["d", "a", "b"]);
  });
});

describe("resolveRecentFileKind", () => {
  it("labels markdown plans and html mockups under plans/", () => {
    expect(resolveRecentFileKind("plans/swap-model.md")).toEqual({
      chip: "md",
      label: "Plan",
    });
    expect(resolveRecentFileKind("plans/sidebar-mockup.html")).toEqual({
      chip: "html",
      label: "Mockup",
    });
  });

  it("reads anything under reports/ as a Report regardless of extension", () => {
    expect(resolveRecentFileKind("reports/architecture.md")).toEqual({
      chip: "report",
      label: "Report",
    });
    expect(resolveRecentFileKind("reports/desktop-size.html")).toEqual({
      chip: "report",
      label: "Report",
    });
  });

  it("treats source files as code and bare markdown as a doc", () => {
    expect(
      resolveRecentFileKind(
        "apps/app/src/components/secondary-panel/NewTabFileSearch.tsx",
      ),
    ).toEqual({ chip: "code", label: "Source" });
    expect(resolveRecentFileKind("README.md")).toEqual({
      chip: "md",
      label: "Doc",
    });
  });
});
