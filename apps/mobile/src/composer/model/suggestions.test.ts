import type { Thread } from "@bb/domain";
import type { ProviderCommand } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildCommandSuggestions,
  buildPathMentionSuggestions,
  buildPluginMentionTriggers,
  buildThreadMentionSuggestions,
  mergeMentionSuggestions,
} from "./suggestions";

function thread(overrides: Partial<Thread> & { id: string }): Thread {
  return {
    title: null,
    titleFallback: null,
    projectId: "proj_1",
    parentThreadId: null,
    visibility: "visible",
    ...overrides,
  } as Thread;
}

describe("buildThreadMentionSuggestions", () => {
  it("fuzzy-matches titles, excludes the current and hidden threads, ranks relations", () => {
    const threads = [
      thread({ id: "thr_self", title: "Login fix" }),
      thread({
        id: "thr_child",
        title: "Login fix child",
        parentThreadId: "thr_self",
      }),
      thread({ id: "thr_other", title: "Login fix", projectId: "proj_2" }),
      thread({ id: "thr_hidden", title: "Login fix", visibility: "hidden" }),
      thread({ id: "thr_none", title: "Unrelated" }),
    ];
    const result = buildThreadMentionSuggestions({
      threads,
      query: "login",
      currentThreadId: "thr_self",
      currentProjectId: "proj_1",
      projectNamesById: new Map([["proj_2", "Other project"]]),
      limit: 8,
    });
    expect(result.map((entry) => entry.threadId)).toEqual([
      "thr_child",
      "thr_other",
    ]);
    expect(result[0]).toMatchObject({
      replacement: "thread:thr_child",
      title: "Login fix child",
    });
    expect(result[1]?.projectName).toBe("Other project");
  });

  it("returns nothing for an empty query", () => {
    expect(
      buildThreadMentionSuggestions({
        threads: [thread({ id: "a", title: "A" })],
        query: "  ",
        projectNamesById: new Map(),
        limit: 8,
      }),
    ).toEqual([]);
  });
});

describe("buildPathMentionSuggestions", () => {
  it("orders by score, workspace before storage, directories first, and builds replacements", () => {
    const result = buildPathMentionSuggestions({
      workspacePaths: [
        {
          path: "src/a.ts",
          name: "a.ts",
          kind: "file",
          score: 5,
          positions: [],
        },
        {
          path: "src",
          name: "src",
          kind: "directory",
          score: 5,
          positions: [],
        },
      ],
      threadStoragePaths: [
        {
          path: "notes.md",
          name: "notes.md",
          kind: "file",
          score: 9,
          positions: [],
        },
        {
          path: "old.md",
          name: "old.md",
          kind: "file",
          score: 5,
          positions: [],
        },
      ],
      limit: 3,
    });
    expect(result.map((entry) => entry.replacement)).toEqual([
      "thread-storage:notes.md",
      "src/",
      "src/a.ts",
    ]);
  });
});

describe("mergeMentionSuggestions", () => {
  it("leads with paths when the query looks like a path", () => {
    const path = {
      kind: "path" as const,
      source: "workspace" as const,
      entryKind: "file" as const,
      path: "a/b",
      name: "b",
      replacement: "a/b",
    };
    const project = {
      kind: "project" as const,
      path: "project:p",
      replacement: "project:p",
      projectId: "p",
      name: "P",
    };
    expect(
      mergeMentionSuggestions({
        query: "a/b",
        threads: [],
        projects: [project],
        sections: [],
        paths: [path],
        plugins: [],
      }),
    ).toEqual([path, project]);
    expect(
      mergeMentionSuggestions({
        query: "ab",
        threads: [],
        projects: [project],
        sections: [],
        paths: [path],
        plugins: [],
      }),
    ).toEqual([project, path]);
  });
});

describe("buildPluginMentionTriggers", () => {
  it("always includes @ and keeps the canonical order", () => {
    expect(buildPluginMentionTriggers([{ triggers: ["$", "#"] }])).toEqual([
      "@",
      "#",
      "$",
    ]);
  });
});

describe("buildCommandSuggestions", () => {
  const commands: ProviderCommand[] = [
    {
      name: "compact",
      source: "command",
      origin: "builtin",
      description: "Compact",
      argumentHint: null,
    },
    {
      name: "review",
      source: "command",
      origin: "user",
      description: "Review the diff",
      argumentHint: null,
    },
    {
      name: "frontend:component",
      source: "skill",
      origin: "project",
      description: null,
      argumentHint: "<name>",
    },
  ];
  const promptActions = [
    { command: { trigger: "/" as const, name: "plan", trailingText: " " } },
  ];

  it("hides builtin compact on the new-thread screen, keeps it for threads", () => {
    const fresh = buildCommandSuggestions({
      commands,
      promptActions,
      trigger: "/",
      scope: "new-thread",
      query: "",
    });
    expect(fresh.map((entry) => entry.name)).not.toContain("compact");
    const thread = buildCommandSuggestions({
      commands,
      promptActions,
      trigger: "/",
      scope: "thread",
      query: "",
    });
    expect(thread.map((entry) => entry.name)).toContain("compact");
  });

  it("filters by name/description/hint and ranks direct name matches first", () => {
    const result = buildCommandSuggestions({
      commands,
      promptActions,
      trigger: "/",
      scope: "thread",
      query: "comp",
    });
    expect(result.map((entry) => entry.name)).toEqual([
      "compact",
      "frontend:component",
    ]);
    const byDescription = buildCommandSuggestions({
      commands,
      promptActions,
      trigger: "/",
      scope: "thread",
      query: "diff",
    });
    expect(byDescription.map((entry) => entry.name)).toEqual(["review"]);
  });

  it("dedupes a prompt action that the catalog also lists", () => {
    const result = buildCommandSuggestions({
      commands: [
        ...commands,
        {
          name: "plan",
          source: "command",
          origin: "user",
          description: "Plan it",
          argumentHint: null,
        },
      ],
      promptActions,
      trigger: "/",
      scope: "thread",
      query: "plan",
    });
    expect(result.filter((entry) => entry.name === "plan")).toHaveLength(1);
  });
});
