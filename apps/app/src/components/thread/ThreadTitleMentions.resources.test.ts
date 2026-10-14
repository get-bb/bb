import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  buildThreadTitleMentionResources,
  EMPTY_TITLE_MENTION_RESOURCES,
  threadTitleTextSegments,
  type ThreadTitleMentionNavigationSource,
} from "./ThreadTitleMentions";

function navigation(
  overrides: Partial<{
    sectionName: string;
    projectName: string;
    threadTitle: string | null;
    updatedAt: number;
  }> = {},
): ThreadTitleMentionNavigationSource {
  return {
    sections: [{ id: "sec_1", name: overrides.sectionName ?? "Backlog" }],
    projects: [
      {
        id: "proj_app",
        name: overrides.projectName ?? "App",
        threads: [
          makeThreadListEntry({
            id: "thr_app",
            projectId: "proj_app",
            title: overrides.threadTitle ?? "Ship it",
            updatedAt: overrides.updatedAt ?? 1,
          }),
        ],
      },
    ],
    personalProject: {
      id: "personal",
      name: "Personal",
      threads: [makeThreadListEntry({ id: "thr_me", projectId: "personal" })],
    },
  };
}

describe("buildThreadTitleMentionResources", () => {
  it("returns the previous resources for a value-equal payload with new identity", () => {
    const first = buildThreadTitleMentionResources(
      navigation(),
      EMPTY_TITLE_MENTION_RESOURCES,
    );
    expect(first.threadById.get("thr_app")?.title).toBe("Ship it");

    const second = buildThreadTitleMentionResources(
      navigation({ updatedAt: 2 }),
      first,
    );
    expect(second).toBe(first);
  });

  it("replaces only the map that changed and keeps unchanged thread entries", () => {
    const first = buildThreadTitleMentionResources(
      navigation(),
      EMPTY_TITLE_MENTION_RESOURCES,
    );
    const renamedProject = buildThreadTitleMentionResources(
      navigation({ projectName: "Application" }),
      first,
    );
    expect(renamedProject).not.toBe(first);
    expect(renamedProject.projectNamesById.get("proj_app")).toBe("Application");
    expect(renamedProject.sectionNamesById).toBe(first.sectionNamesById);
    expect(renamedProject.threadById).toBe(first.threadById);

    const retitled = buildThreadTitleMentionResources(
      navigation({ projectName: "Application", threadTitle: "Shipped" }),
      renamedProject,
    );
    expect(retitled.threadById).not.toBe(renamedProject.threadById);
    expect(retitled.threadById.get("thr_app")?.title).toBe("Shipped");
    expect(retitled.threadById.get("thr_me")).toBe(
      renamedProject.threadById.get("thr_me"),
    );
    expect(retitled.projectNamesById).toBe(renamedProject.projectNamesById);
  });

  it("drops to the shared empty resources when the payload disappears", () => {
    const first = buildThreadTitleMentionResources(
      navigation(),
      EMPTY_TITLE_MENTION_RESOURCES,
    );
    expect(buildThreadTitleMentionResources(undefined, first)).toBe(
      EMPTY_TITLE_MENTION_RESOURCES,
    );
    expect(
      buildThreadTitleMentionResources(
        undefined,
        EMPTY_TITLE_MENTION_RESOURCES,
      ),
    ).toBe(EMPTY_TITLE_MENTION_RESOURCES);
  });
});

describe("threadTitleTextSegments", () => {
  const rawId = "thr_dcwivn5n8w";

  function resourcesWithThread(title: string) {
    return {
      ...EMPTY_TITLE_MENTION_RESOURCES,
      threadById: new Map([
        [
          rawId,
          makeThreadListEntry({
            id: rawId,
            projectId: "proj_target",
            title,
            titleFallback: title,
          }),
        ],
      ]),
    };
  }

  it("renders serialized mentions in the thread title as pills", () => {
    const segments = threadTitleTextSegments(
      "Review @docs/foo.test.ts with @thread:thr_worker",
      EMPTY_TITLE_MENTION_RESOURCES,
    );

    expect(segments.map((segment) => segment.text)).toEqual([
      "Review ",
      "foo.test.ts",
      " with ",
      "thr_worker",
    ]);
    expect(segments[1]?.resource).toMatchObject({
      kind: "path",
      path: "docs/foo.test.ts",
    });
    expect(segments[3]?.resource).toMatchObject({
      kind: "thread",
      threadId: "thr_worker",
    });
  });

  it("renders a raw thread id in the title as a mention pill", () => {
    const segments = threadTitleTextSegments(
      `Continue from ${rawId} docs/foo.ts`,
      resourcesWithThread("Raw title target"),
    );

    expect(segments.map((segment) => segment.text)).toEqual([
      "Continue from ",
      "Raw title target",
      " docs/foo.ts",
    ]);
    expect(segments[1]?.resource).toMatchObject({
      kind: "thread",
      threadId: rawId,
    });
  });

  it.each([
    ["straight closing quote", `Review "${rawId}."`],
    ["curly closing quote", `Review “${rawId}.”`],
  ])(
    "renders a sentence-final raw id before a %s in a title",
    (_label, title) => {
      const segments = threadTitleTextSegments(
        title,
        resourcesWithThread("Quoted title target"),
      );

      expect(segments.find((segment) => segment.resource !== null)?.text).toBe(
        "Quoted title target",
      );
    },
  );

  it("leaves raw-id path, extension, and overlong continuations literal in titles", () => {
    const title = [
      `${rawId}.md`,
      `${rawId}/path`,
      `${rawId}2`,
      `/tmp/${rawId}`,
      `docs/${rawId}`,
      `C:\\tmp\\${rawId}`,
      `docs\\${rawId}`,
      `${rawId}\\logs`,
    ].join(" ");

    expect(
      threadTitleTextSegments(title, resourcesWithThread("Should not render")),
    ).toEqual([
      {
        resource: null,
        serializedText: null,
        text: title,
        unresolvedThreadId: null,
      },
    ]);
  });

  it("leaves an unresolvable raw thread id literal and requests it", () => {
    expect(
      threadTitleTextSegments(
        "Unknown thr_2222222222",
        EMPTY_TITLE_MENTION_RESOURCES,
      ),
    ).toEqual([
      {
        resource: null,
        serializedText: null,
        text: "Unknown ",
        unresolvedThreadId: null,
      },
      {
        resource: null,
        serializedText: "thr_2222222222",
        text: "thr_2222222222",
        unresolvedThreadId: "thr_2222222222",
      },
    ]);
  });
});
