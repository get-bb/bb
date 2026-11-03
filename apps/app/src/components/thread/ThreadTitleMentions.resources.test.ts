import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  buildThreadTitleMentionResources,
  EMPTY_TITLE_MENTION_RESOURCES,
  resolveThreadTitleDisplayText,
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

describe("resolveThreadTitleDisplayText", () => {
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

  it.each([
    [
      "mid-title",
      `Continue from ${rawId} docs/foo.ts`,
      "Continue from Raw title target docs/foo.ts",
    ],
    [
      "before a straight closing quote",
      `Review "${rawId}."`,
      'Review "Raw title target."',
    ],
    [
      "before a curly closing quote",
      `Review \u201c${rawId}.\u201d`,
      "Review \u201cRaw title target.\u201d",
    ],
  ])(
    "shows a known raw thread id %s as its title",
    (_label, title, expected) => {
      expect(
        resolveThreadTitleDisplayText(
          title,
          resourcesWithThread("Raw title target"),
        ),
      ).toBe(expected);
    },
  );
});
