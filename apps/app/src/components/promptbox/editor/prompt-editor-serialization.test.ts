import { describe, expect, it } from "vitest";
import type { PromptTextMention } from "@bb/domain";
import {
  promptCommandResourceFromSuggestion,
  promptEditorInlineContentFromValue,
} from "./prompt-editor-serialization";

describe("prompt editor serialization", () => {
  it("builds command mention resources from provider command suggestions", () => {
    expect(
      promptCommandResourceFromSuggestion({
        trigger: "$",
        suggestion: {
          kind: "command",
          name: "review",
          source: "skill",
          origin: "user",
          description: "Review code changes",
          argumentHint: "<files>",
        },
      }),
    ).toEqual({
      kind: "command",
      trigger: "$",
      name: "review",
      source: "skill",
      origin: "user",
      label: "review",
      argumentHint: "<files>",
    });
  });

  it("serializes a selected skill as a pill without materializing argument hint text", () => {
    const text = "$review ";
    const mentions: PromptTextMention[] = [
      {
        start: 0,
        end: "$review".length,
        resource: {
          kind: "command",
          trigger: "$",
          name: "review",
          source: "skill",
          origin: "user",
          label: "review",
          argumentHint: "<files>",
        },
      },
    ];

    expect(promptEditorInlineContentFromValue({ text, mentions })).toEqual([
      {
        type: "mention",
        attrs: {
          resource: mentions[0].resource,
          serializedText: "$review",
        },
      },
      { type: "text", text: " " },
    ]);
  });
});
