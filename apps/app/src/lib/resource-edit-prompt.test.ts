import { describe, expect, it } from "vitest";
import {
  buildPluginEditThreadPrompt,
  buildSkillEditThreadPrompt,
} from "@/lib/resource-edit-prompt";
import { initialPromptSeedFromComposer } from "@/lib/plugin-composer-handle";

describe("resource edit thread prompts", () => {
  it("points the thread at the writable resource with a path mention", () => {
    expect(
      initialPromptSeedFromComposer(
        buildPluginEditThreadPrompt({
          name: "Pattern Atlas",
          path: "/Users/me/plugins/pattern-atlas/",
        }),
        null,
      ),
    ).toEqual({
      text: 'Edit the bb plugin "Pattern Atlas" at @/Users/me/plugins/pattern-atlas/. I want to ',
      mentions: [
        {
          start: 38,
          end: 71,
          resource: {
            kind: "path",
            source: "workspace",
            entryKind: "directory",
            path: "/Users/me/plugins/pattern-atlas",
            label: "pattern-atlas",
          },
        },
      ],
    });
    expect(
      initialPromptSeedFromComposer(
        buildSkillEditThreadPrompt({
          id: "skill_abc123",
          name: "Review PR",
          path: "/Users/me/.bb/skills/review-pr/SKILL.md",
        }),
        null,
      ),
    ).toEqual({
      text: 'Edit the bb skill "Review PR" (ID skill_abc123) at @/Users/me/.bb/skills/review-pr/SKILL.md. Inspect it with bb skill show skill_abc123 --json and pass that revision to bb skill update when saving. I want to ',
      mentions: [
        {
          start: 51,
          end: 91,
          resource: {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "/Users/me/.bb/skills/review-pr/SKILL.md",
            label: "SKILL.md",
          },
        },
      ],
    });
  });

  it("refuses a kindless plugin mention when core seeds the draft", () => {
    expect(() =>
      initialPromptSeedFromComposer(
        [{ provider: "notes", id: "n1", label: "Note" }],
        null,
      ),
    ).toThrow('Mention "Note" has no kind and no plugin to resolve it.');
  });
});
