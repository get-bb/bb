import { describe, expect, it } from "vitest";
import {
  buildTree,
  decodeSubPath,
  filterTree,
  isMarkdownPath,
  joinPath,
  nameError,
  parentOf,
  withMarkdownExtension,
} from "./notes-tree.js";

describe("isMarkdownPath", () => {
  it("accepts the usual markdown extensions", () => {
    expect(isMarkdownPath("a.md")).toBe(true);
    expect(isMarkdownPath("a.markdown")).toBe(true);
    expect(isMarkdownPath("a.MD")).toBe(true);
  });

  it("rejects other files", () => {
    expect(isMarkdownPath("a.txt")).toBe(false);
    expect(isMarkdownPath("notes")).toBe(false);
  });

  it("rejects a dotfile with no extension", () => {
    expect(isMarkdownPath(".md")).toBe(false);
  });
});

describe("buildTree", () => {
  it("nests files under their folders", () => {
    const tree = buildTree([
      { path: "work", kind: "directory" },
      { path: "work/plan.md", kind: "file" },
      { path: "top.md", kind: "file" },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["work", "top.md"]);
    expect(tree[0]?.children.map((node) => node.name)).toEqual(["plan.md"]);
  });

  it("leaves out non-markdown files", () => {
    const tree = buildTree([
      { path: "note.md", kind: "file" },
      { path: "image.png", kind: "file" },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["note.md"]);
  });

  it("keeps an empty folder so a fresh one is visible", () => {
    const tree = buildTree([{ path: "new-folder", kind: "directory" }]);
    expect(tree.map((node) => node.name)).toEqual(["new-folder"]);
  });

  it("hides dotfiles and dot-directories", () => {
    const tree = buildTree([
      { path: ".vscode", kind: "directory" },
      { path: ".vscode/settings.json", kind: "file" },
      { path: ".hidden.md", kind: "file" },
      { path: "visible.md", kind: "file" },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["visible.md"]);
  });

  it("infers a missing parent directory entry", () => {
    const tree = buildTree([{ path: "a/b/c.md", kind: "file" }]);
    expect(tree[0]?.name).toBe("a");
    expect(tree[0]?.children[0]?.name).toBe("b");
  });

  it("sorts folders before files, each alphabetically", () => {
    const tree = buildTree([
      { path: "z.md", kind: "file" },
      { path: "a.md", kind: "file" },
      { path: "zed", kind: "directory" },
      { path: "alpha", kind: "directory" },
    ]);
    expect(tree.map((node) => node.name)).toEqual([
      "alpha",
      "zed",
      "a.md",
      "z.md",
    ]);
  });
});

describe("filterTree", () => {
  const tree = buildTree([
    { path: "work/plan.md", kind: "file" },
    { path: "work/notes.md", kind: "file" },
    { path: "personal/recipe.md", kind: "file" },
  ]);

  it("returns everything for an empty query", () => {
    expect(filterTree(tree, "  ").nodes).toHaveLength(2);
  });

  it("keeps only matching files and expands their folders", () => {
    const filtered = filterTree(tree, "plan");
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.nodes[0]?.children.map((node) => node.name)).toEqual([
      "plan.md",
    ]);
    expect(filtered.expand.has("work")).toBe(true);
  });

  it("keeps a folder whose own name matches", () => {
    const filtered = filterTree(tree, "personal");
    expect(filtered.nodes.map((node) => node.name)).toEqual(["personal"]);
  });

  it("returns nothing when there is no match", () => {
    expect(filterTree(tree, "zzz").nodes).toEqual([]);
  });
});

describe("nameError", () => {
  it("accepts an ordinary name", () => {
    expect(nameError("Meeting notes")).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(nameError("   ")).toBe("Enter a name");
  });

  it("rejects a traversal attempt", () => {
    expect(nameError("..")).toBe("That name is reserved");
  });

  it("rejects separators, so a name cannot become a path", () => {
    expect(nameError("a/b")).toBe("Names cannot contain slashes");
    expect(nameError("a\\b")).toBe("Names cannot contain slashes");
  });

  it("rejects a leading dot, which the tree would then hide", () => {
    expect(nameError(".hidden")).toBe("Names cannot start with a dot");
  });
});

describe("withMarkdownExtension", () => {
  it("appends .md when absent", () => {
    expect(withMarkdownExtension("plan")).toBe("plan.md");
  });

  it("leaves an existing markdown extension alone", () => {
    expect(withMarkdownExtension("plan.md")).toBe("plan.md");
  });

  it("appends to a name whose extension is not markdown", () => {
    expect(withMarkdownExtension("v1.2")).toBe("v1.2.md");
  });
});

describe("joinPath and parentOf", () => {
  it("joins against the root", () => {
    expect(joinPath("", "a.md")).toBe("a.md");
  });

  it("joins against a folder", () => {
    expect(joinPath("work", "a.md")).toBe("work/a.md");
  });

  it("reports the parent folder", () => {
    expect(parentOf("work/sub/a.md")).toBe("work/sub");
  });

  it("reports the root for a top-level file", () => {
    expect(parentOf("a.md")).toBe("");
  });
});

describe("decodeSubPath", () => {
  it("decodes a space in a note name", () => {
    expect(decodeSubPath("meeting%20notes.md")).toBe("meeting notes.md");
  });

  it("decodes every segment of a nested path", () => {
    expect(decodeSubPath("my%20folder/a%20note.md")).toBe(
      "my folder/a note.md",
    );
  });

  it("leaves an unencoded path untouched", () => {
    expect(decodeSubPath("work/plan.md")).toBe("work/plan.md");
  });

  it("decodes a literal percent in a filename", () => {
    expect(decodeSubPath("100%25%20done.md")).toBe("100% done.md");
  });

  it("falls back to the raw segment on a malformed escape", () => {
    expect(decodeSubPath("bad%zz.md")).toBe("bad%zz.md");
  });
});
