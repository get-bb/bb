import { describe, expect, it, vi } from "vitest";
import { loadPluginReferences } from "./app";

describe("loadPluginReferences", () => {
  it("merges installed plugins over catalog results through the public API", async () => {
    const list = vi.fn(async () => ({
      plugins: [
        { id: "github", icon: null, iconUrl: "/icons/github.svg" },
        { id: "docs", icon: "Book", iconUrl: null },
      ],
    }));
    const search = vi.fn(async () => ({
      results: [
        {
          pluginId: "github",
          icon: "Github",
          iconUrl: null,
          iconTinted: false,
        },
        {
          pluginId: "tasks",
          icon: "ListTodo",
          iconUrl: null,
          iconTinted: true,
        },
      ],
      collections: [],
    }));
    const references = await loadPluginReferences(
      { plugins: { list, catalog: { search } } } as never,
      new AbortController().signal,
    );
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: "" }));
    expect([...references.keys()].sort()).toEqual(["docs", "github", "tasks"]);
    expect(references.get("github")).toEqual({
      id: "github",
      icon: null,
      iconUrl: "/icons/github.svg",
      iconTinted: true,
    });
    expect(references.get("tasks")?.iconTinted).toBe(true);
  });

  it("treats a failing source as empty instead of dropping the whole map", async () => {
    const references = await loadPluginReferences(
      {
        plugins: {
          list: async () => {
            throw new Error("offline");
          },
          catalog: {
            search: async () => ({
              results: [
                {
                  pluginId: "tasks",
                  icon: null,
                  iconUrl: null,
                  iconTinted: false,
                },
              ],
              collections: [],
            }),
          },
        },
      } as never,
      new AbortController().signal,
    );
    expect([...references.keys()]).toEqual(["tasks"]);
  });
});
