import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import { makeThread as makeThreadFixture } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { buildThreadMentionSuggestions } from "./threadMentionSuggestions";

interface ThreadFixtureOptions {
  environmentId?: string | null;
  id: string;
  parentThreadId?: string | null;
  projectId?: string;
  title: string | null;
  titleFallback?: string | null;
  updatedAt?: number;
  visibility?: Thread["visibility"];
}

interface BuildSuggestionFixtureArgs {
  threads: readonly Thread[];
  query: string;
  currentEnvironmentId?: string | null;
  currentProjectId?: string;
  currentThreadId?: string;
  limit?: number;
}

function makeThread(options: ThreadFixtureOptions): Thread {
  return makeThreadFixture({
    id: options.id,
    projectId: options.projectId ?? "proj-1",
    environmentId:
      options.environmentId === undefined ? "env-1" : options.environmentId,
    providerId: "openai",
    title: options.title,
    titleFallback: options.titleFallback ?? null,
    parentThreadId: options.parentThreadId ?? null,
    visibility: options.visibility ?? "visible",
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: options.updatedAt ?? 1,
  });
}

function getSuggestionThreadIds(
  args: BuildSuggestionFixtureArgs,
): readonly string[] {
  return buildThreadMentionSuggestions({
    threads: args.threads,
    query: args.query,
    currentEnvironmentId: args.currentEnvironmentId ?? null,
    currentProjectId: args.currentProjectId,
    currentThreadId: args.currentThreadId,
    projectNamesById: new Map([
      ["proj-1", "Core App"],
      ["proj-2", "Docs Site"],
    ]),
    limit: args.limit ?? 8,
    resolveTitle: (title) => title,
  }).map((suggestion) => suggestion.threadId);
}

describe("buildThreadMentionSuggestions", () => {
  it("matches non-contiguous title queries", () => {
    const threads = [
      makeThread({
        id: "thr_research",
        title: "Research notes",
      }),
      makeThread({
        id: "thr_prompt",
        title: "Prompt mention improvements",
      }),
      makeThread({
        id: "thr_release",
        title: "Release checklist",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "pmi",
      }),
    ).toEqual(["thr_prompt"]);
  });

  it("matches thread ids", () => {
    const threads = [
      makeThread({
        id: "thr_alpha",
        title: "Design review",
      }),
      makeThread({
        id: "thr_beta",
        title: "Implementation plan",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "beta",
      }),
    ).toEqual(["thr_beta"]);
  });

  it("excludes the current thread", () => {
    const threads = [
      makeThread({
        id: "thr_current",
        title: "Prompt mention improvements",
      }),
      makeThread({
        id: "thr_other",
        title: "Prompt mention rollout",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "prompt",
        currentThreadId: "thr_current",
      }),
    ).toEqual(["thr_other"]);
  });

  it("excludes side chats", () => {
    const threads = [
      makeThread({
        id: "thr_parent",
        title: "Prompt mention improvements",
      }),
      makeThread({
        id: "thr_side_chat",
        visibility: "hidden",
        title: "Prompt mention side chat",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "prompt mention",
      }),
    ).toEqual(["thr_parent"]);
  });

  it("returns threads with deterministic ties", () => {
    const threads = [
      makeThread({
        id: "thr_later",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_earlier",
        title: "Shared context",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "shared",
      }),
    ).toEqual(["thr_earlier", "thr_later"]);
  });

  it("ranks directly related, same-parent, and same-project thread matches together", () => {
    const threads = [
      makeThread({
        id: "thr_current",
        parentThreadId: "thr_parent",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_other_project_parent",
        environmentId: "env-2",
        projectId: "proj-2",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_same_project",
        environmentId: "env-3",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_sibling",
        parentThreadId: "thr_parent",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_parent",
        title: "Shared context",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "shared",
        currentProjectId: "proj-1",
        currentThreadId: "thr_current",
      }),
    ).toEqual([
      "thr_parent",
      "thr_sibling",
      "thr_same_project",
      "thr_other_project_parent",
    ]);
  });

  it("ranks children of the current parent as directly related", () => {
    const threads = [
      makeThread({
        id: "thr_parent",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_same_project_parent",
        environmentId: "env-3",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_other_project_parent",
        environmentId: "env-2",
        projectId: "proj-2",
        title: "Shared context",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "shared",
        currentProjectId: "proj-1",
        currentThreadId: "thr_parent",
      }),
    ).toEqual([
      "thr_child",
      "thr_same_project_parent",
      "thr_other_project_parent",
    ]);
  });

  it("adds project names only for threads outside the current project", () => {
    const suggestions = buildThreadMentionSuggestions({
      threads: [
        makeThread({
          id: "thr_current_project",
          projectId: "proj-1",
          title: "Shared context",
        }),
        makeThread({
          id: "thr_other_project",
          projectId: "proj-2",
          title: "Shared context",
        }),
      ],
      query: "shared",
      currentEnvironmentId: null,
      currentProjectId: "proj-1",
      projectNamesById: new Map([
        ["proj-1", "Core App"],
        ["proj-2", "Docs Site"],
      ]),
      limit: 8,
      resolveTitle: (title) => title,
    });

    expect(
      suggestions.map((suggestion) => ({
        projectId: suggestion.projectId,
        projectName: suggestion.projectName,
        threadId: suggestion.threadId,
      })),
    ).toEqual([
      {
        projectId: "proj-1",
        projectName: undefined,
        threadId: "thr_current_project",
      },
      {
        projectId: "proj-2",
        projectName: "Docs Site",
        threadId: "thr_other_project",
      },
    ]);
  });

  it("adds project names when the current project is unknown", () => {
    const suggestions = buildThreadMentionSuggestions({
      threads: [
        makeThread({
          id: "thr_first_project",
          projectId: "proj-1",
          title: "Shared context",
        }),
        makeThread({
          id: "thr_second_project",
          projectId: "proj-2",
          title: "Shared context",
        }),
      ],
      query: "shared",
      currentEnvironmentId: null,
      projectNamesById: new Map([
        ["proj-1", "Core App"],
        ["proj-2", "Docs Site"],
      ]),
      limit: 8,
      resolveTitle: (title) => title,
    });

    expect(
      suggestions.map((suggestion) => ({
        projectId: suggestion.projectId,
        projectName: suggestion.projectName,
        threadId: suggestion.threadId,
      })),
    ).toEqual([
      {
        projectId: "proj-1",
        projectName: "Core App",
        threadId: "thr_first_project",
      },
      {
        projectId: "proj-2",
        projectName: "Docs Site",
        threadId: "thr_second_project",
      },
    ]);
  });

  it("does not add the personal project name to projectless thread suggestions", () => {
    const suggestions = buildThreadMentionSuggestions({
      threads: [
        makeThread({
          id: "thr_personal",
          projectId: PERSONAL_PROJECT_ID,
          title: "Shared context",
        }),
        makeThread({
          id: "thr_project",
          projectId: "proj-2",
          title: "Shared context",
        }),
      ],
      query: "shared",
      currentEnvironmentId: null,
      currentProjectId: "proj-1",
      projectNamesById: new Map([
        [PERSONAL_PROJECT_ID, "Personal"],
        ["proj-2", "Docs Site"],
      ]),
      limit: 8,
      resolveTitle: (title) => title,
    });

    expect(
      suggestions.map((suggestion) => ({
        projectId: suggestion.projectId,
        projectName: suggestion.projectName,
        threadId: suggestion.threadId,
      })),
    ).toEqual([
      {
        projectId: PERSONAL_PROJECT_ID,
        projectName: undefined,
        threadId: "thr_personal",
      },
      {
        projectId: "proj-2",
        projectName: "Docs Site",
        threadId: "thr_project",
      },
    ]);
  });
  it("labels parent, child, sibling and same-environment relations", () => {
    const suggestions = buildThreadMentionSuggestions({
      threads: [
        makeThread({
          id: "thr_current",
          parentThreadId: "thr_parent",
          title: "Shared current",
        }),
        makeThread({ id: "thr_parent", title: "Shared parent" }),
        makeThread({
          id: "thr_child",
          parentThreadId: "thr_current",
          title: "Shared child",
        }),
        makeThread({
          id: "thr_sibling",
          parentThreadId: "thr_parent",
          environmentId: "env-2",
          title: "Shared sibling",
        }),
        makeThread({ id: "thr_roommate", title: "Shared roommate" }),
        makeThread({
          id: "thr_elsewhere",
          environmentId: "env-2",
          title: "Shared elsewhere",
        }),
      ],
      query: "shared",
      currentEnvironmentId: "env-1",
      currentProjectId: "proj-1",
      currentThreadId: "thr_current",
      projectNamesById: new Map([["proj-1", "Core App"]]),
      limit: 8,
      resolveTitle: (title) => title,
    });

    expect(
      new Map(
        suggestions.map((suggestion) => [
          suggestion.threadId,
          suggestion.relation,
        ]),
      ),
    ).toEqual(
      new Map([
        ["thr_parent", "parent"],
        ["thr_child", "child"],
        ["thr_sibling", "same-parent"],
        ["thr_roommate", "same-environment"],
        ["thr_elsewhere", null],
      ]),
    );
  });

  it("falls back to the current thread's environment when none is supplied", () => {
    const suggestions = buildThreadMentionSuggestions({
      threads: [
        makeThread({
          id: "thr_current",
          environmentId: "env-9",
          title: "Shared current",
        }),
        makeThread({
          id: "thr_roommate",
          environmentId: "env-9",
          title: "Shared roommate",
        }),
      ],
      query: "shared",
      currentEnvironmentId: null,
      currentProjectId: "proj-1",
      currentThreadId: "thr_current",
      projectNamesById: new Map([["proj-1", "Core App"]]),
      limit: 8,
      resolveTitle: (title) => title,
    });

    expect(suggestions.map((suggestion) => suggestion.relation)).toEqual([
      "same-environment",
    ]);
  });

  it("does not claim a same-environment relation for environmentless threads", () => {
    const suggestions = buildThreadMentionSuggestions({
      threads: [
        makeThread({
          id: "thr_current",
          environmentId: null,
          title: "Shared current",
        }),
        makeThread({
          id: "thr_other",
          environmentId: null,
          title: "Shared other",
        }),
      ],
      query: "shared",
      currentEnvironmentId: null,
      currentProjectId: "proj-1",
      currentThreadId: "thr_current",
      projectNamesById: new Map([["proj-1", "Core App"]]),
      limit: 8,
      resolveTitle: (title) => title,
    });

    expect(suggestions.map((suggestion) => suggestion.relation)).toEqual([
      null,
    ]);
  });

  it("keeps parent and child ahead of same-environment threads", () => {
    expect(
      getSuggestionThreadIds({
        threads: [
          makeThread({
            id: "thr_current",
            parentThreadId: "thr_parent",
            title: "Shared current",
          }),
          makeThread({ id: "thr_roommate", title: "Shared roommate" }),
          makeThread({ id: "thr_parent", title: "Shared parent" }),
          makeThread({
            id: "thr_child",
            parentThreadId: "thr_current",
            title: "Shared child",
          }),
        ],
        query: "shared",
        currentEnvironmentId: "env-1",
        currentProjectId: "proj-1",
        currentThreadId: "thr_current",
      }),
    ).toEqual(["thr_child", "thr_parent", "thr_roommate"]);
  });
  it("ranks a same-environment thread ahead of unrelated matches with the same title", () => {
    expect(
      getSuggestionThreadIds({
        threads: [
          makeThread({
            id: "thr_current",
            environmentId: "env-1",
            title: "Investigate ask mode bug",
          }),
          makeThread({
            id: "thr_a_elsewhere",
            environmentId: "env-2",
            title: "Explain this branch",
          }),
          makeThread({
            id: "thr_b_elsewhere",
            environmentId: "env-3",
            title: "Explain this branch",
          }),
          makeThread({
            id: "thr_c_roommate",
            environmentId: "env-1",
            title: "Explain this branch",
          }),
        ],
        query: "explain",
        currentEnvironmentId: "env-1",
        currentProjectId: "proj-1",
        currentThreadId: "thr_current",
      }),
    ).toEqual(["thr_c_roommate", "thr_a_elsewhere", "thr_b_elsewhere"]);
  });

  it("breaks remaining ties by most recent activity", () => {
    expect(
      getSuggestionThreadIds({
        threads: [
          makeThread({
            id: "thr_a_stale",
            title: "Explain this branch",
            updatedAt: 10,
          }),
          makeThread({
            id: "thr_b_recent",
            title: "Explain this branch",
            updatedAt: 90,
          }),
          makeThread({
            id: "thr_c_middle",
            title: "Explain this branch",
            updatedAt: 50,
          }),
        ],
        query: "explain",
        currentEnvironmentId: "env-1",
        currentProjectId: "proj-1",
      }),
    ).toEqual(["thr_b_recent", "thr_c_middle", "thr_a_stale"]);
  });

  it("keeps a stronger title match ahead of a weaker match on a related thread", () => {
    expect(
      getSuggestionThreadIds({
        threads: [
          makeThread({ id: "thr_current", title: "Current work" }),
          makeThread({
            id: "thr_child",
            parentThreadId: "thr_current",
            title: "Extra plan for internal notes",
          }),
          makeThread({
            id: "thr_unrelated",
            environmentId: "env-2",
            projectId: "proj-2",
            title: "Explain this branch",
          }),
        ],
        query: "explain",
        currentEnvironmentId: "env-1",
        currentProjectId: "proj-1",
        currentThreadId: "thr_current",
      }),
    ).toEqual(["thr_unrelated", "thr_child"]);
  });

  it("prefers a related thread over a tighter fuzzy score in the same match rank", () => {
    expect(
      getSuggestionThreadIds({
        threads: [
          makeThread({ id: "thr_current", title: "Current work" }),
          makeThread({
            id: "thr_child",
            parentThreadId: "thr_current",
            title: "Explain this branch in detail",
          }),
          makeThread({
            id: "thr_unrelated",
            environmentId: "env-2",
            projectId: "proj-2",
            title: "Explain it",
          }),
        ],
        query: "explain",
        currentEnvironmentId: "env-1",
        currentProjectId: "proj-1",
        currentThreadId: "thr_current",
      }),
    ).toEqual(["thr_child", "thr_unrelated"]);
  });

  it("keeps the strongest matches when the limit truncates related threads", () => {
    expect(
      getSuggestionThreadIds({
        threads: [
          makeThread({ id: "thr_current", title: "Current work" }),
          makeThread({
            id: "thr_child_fuzzy",
            parentThreadId: "thr_current",
            title: "Extra pipeline audit notes",
          }),
          makeThread({
            id: "thr_unrelated_exact",
            environmentId: "env-2",
            projectId: "proj-2",
            title: "Explain",
          }),
        ],
        query: "explain",
        currentEnvironmentId: "env-1",
        currentProjectId: "proj-1",
        currentThreadId: "thr_current",
        limit: 1,
      }),
    ).toEqual(["thr_unrelated_exact"]);
  });
  it("matches a title mention by the mentioned thread's visible name", () => {
    const threads = [
      makeThread({
        id: "thr_follow_up",
        projectId: "proj-1",
        title: "Continue from @thread:thr_design",
      }),
    ];
    const buildWithResolver = (resolveTitle: (title: string) => string) =>
      buildThreadMentionSuggestions({
        threads,
        query: "design review",
        currentEnvironmentId: null,
        currentProjectId: "proj-1",
        projectNamesById: new Map(),
        limit: 8,
        resolveTitle,
      }).map((suggestion) => suggestion.threadId);

    expect(buildWithResolver((title) => title)).toEqual([]);
    expect(
      buildWithResolver((title) =>
        title.replace("@thread:thr_design", "Design review"),
      ),
    ).toEqual(["thr_follow_up"]);
  });
});
