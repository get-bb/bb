import { describe, expect, it } from "vitest";
import type { PromptMentionResource } from "@bb/domain";
import { orderMentionCandidates } from "../src/prompt/mentions/mention-candidates.js";
import { composerMentionGroupsFromOrdered } from "../src/prompt/mentions/composer-suggestions.js";
import type { PromptMentionSuggestion } from "../src/prompt/mentions/types.js";
import {
  composerDraftFromPromptDraft,
  composerMentionTargetFromResource,
  promptDraftFromComposerDraft,
  promptMentionResourceFromComposerMention,
} from "../src/prompt/mentions/composer-mention.js";

const pluginResource: PromptMentionResource = {
  kind: "plugin",
  pluginId: "issues-plugin",
  itemId: "issues:ISS-42",
  label: "ISS-42",
  icon: null,
};

describe("composer mention conversion", () => {
  it("splits a plugin item id into provider and id and joins it back", () => {
    const target = composerMentionTargetFromResource(pluginResource);
    expect(target).toEqual({
      kind: "plugin",
      pluginId: "issues-plugin",
      provider: "issues",
      id: "ISS-42",
      label: "ISS-42",
      icon: null,
    });
    expect(promptMentionResourceFromComposerMention(target)).toEqual(
      pluginResource,
    );
  });

  it("keeps an id containing the separator intact after the provider", () => {
    const resource: PromptMentionResource = {
      ...pluginResource,
      itemId: "docs:guides:setup",
    };
    expect(
      promptMentionResourceFromComposerMention(
        composerMentionTargetFromResource(resource),
      ),
    ).toEqual(resource);
  });

  it("round-trips a draft with mentions and attachments", () => {
    const draft = {
      text: "See @ISS-42",
      mentions: [{ start: 4, end: 11, resource: pluginResource }],
      attachments: [
        { type: "localFile" as const, path: "a.txt", name: "a.txt" },
      ],
    };
    const composer = composerDraftFromPromptDraft(draft);
    expect(composer.mentions[0]).toMatchObject({
      from: 4,
      to: 11,
      id: "ISS-42",
    });
    expect(promptDraftFromComposerDraft(composer)).toEqual(draft);
  });
});

describe("composer mention suggestion conversion", () => {
  const suggestions: PromptMentionSuggestion[] = [
    {
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "src/app.ts",
      name: "app.ts",
      replacement: "src/app.ts",
    },
    {
      kind: "thread",
      path: "thread:thr_1",
      replacement: "thread:thr_1",
      projectId: "prj_1",
      projectName: "bb",
      threadId: "thr_1",
      title: "Fix the composer",
      relation: "child",
    },
    {
      kind: "plugin",
      pluginId: "issues-plugin",
      providerId: "issues",
      itemId: "issues:ISS-42",
      providerLabel: "Issues",
      title: "ISS-42",
      subtitle: "Open",
      icon: null,
      replacement: "ISS-42",
    },
  ];
  const results = orderMentionCandidates(
    suggestions.map((suggestion, index) => ({
      suggestion,
      visibleTitle: `item ${index}`,
      identityTerms: [],
      supportingTerms: [],
      groupKey: suggestion.kind,
      groupLabel: suggestion.kind,
    })),
    "",
  );

  it("keeps groups and their order in the public shape", () => {
    const groups = composerMentionGroupsFromOrdered(results);
    expect(
      groups.map((group) => group.suggestions.map((item) => item.text)),
    ).toEqual(
      results.groups.map((group) =>
        group.suggestions.map((item) => item.replacement),
      ),
    );
    expect(groups.flatMap((group) => group.suggestions)).toContainEqual(
      expect.objectContaining({
        kind: "plugin",
        text: "ISS-42",
        mention: expect.objectContaining({ provider: "issues", id: "ISS-42" }),
        providerLabel: "Issues",
      }),
    );
  });

  it("tells an untitled thread apart while its pill falls back to the id", () => {
    const [group] = composerMentionGroupsFromOrdered({
      groups: [
        {
          key: "threads",
          label: "Threads",
          startIndex: 0,
          suggestions: [
            {
              kind: "thread",
              path: "thread:thr_1",
              replacement: "thread:thr_1",
              projectId: "prj_1",
              threadId: "thr_1",
              title: "",
              relation: null,
            },
          ],
        },
      ],
      suggestions: [],
    });
    expect(group?.suggestions[0]).toMatchObject({
      title: null,
      mention: { label: "thr_1" },
    });
  });
});
