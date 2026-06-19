import { describe, expect, it } from "vitest";
import {
  promptInputHasCommandMention,
  promptMentionCommandTriggerSchema,
  promptMentionCommandTriggerValues,
  promptMentionResourceSchema,
  removeCommandMentionsFromPromptInput,
} from "../src/shared-types.js";

describe("prompt mention command triggers", () => {
  it("accepts slash as the only command trigger", () => {
    expect(promptMentionCommandTriggerValues).toEqual(["/"]);
    expect(promptMentionCommandTriggerSchema.safeParse("/").success).toBe(true);
    expect(promptMentionCommandTriggerSchema.safeParse("$").success).toBe(
      false,
    );
  });

  it("rejects legacy dollar command mention resources", () => {
    expect(
      promptMentionResourceSchema.safeParse({
        kind: "command",
        trigger: "$",
        name: "review",
        source: "skill",
        origin: "user",
        label: "review",
        argumentHint: null,
      }).success,
    ).toBe(false);
  });
});

describe("prompt command input helpers", () => {
  it("detects and removes command mentions while preserving ordinary text", () => {
    const input = [
      {
        type: "text" as const,
        text: "/plan review @thread",
        mentions: [
          {
            start: 0,
            end: 5,
            resource: {
              kind: "command" as const,
              trigger: "/" as const,
              name: "plan",
              source: "command" as const,
              origin: "user" as const,
              label: "plan",
              argumentHint: null,
            },
          },
          {
            start: 13,
            end: 20,
            resource: {
              kind: "thread" as const,
              threadId: "thr_123",
              label: "thread",
            },
          },
        ],
      },
    ];

    expect(
      promptInputHasCommandMention(input, { trigger: "/", name: "plan" }),
    ).toBe(true);
    expect(
      removeCommandMentionsFromPromptInput(input, {
        trigger: "/",
        name: "plan",
      }),
    ).toEqual([
      {
        type: "text",
        text: "review @thread",
        mentions: [
          {
            start: 7,
            end: 14,
            resource: {
              kind: "thread",
              threadId: "thr_123",
              label: "thread",
            },
          },
        ],
      },
    ]);
  });

  it("ignores plain text that looks like a command", () => {
    const input = [{ type: "text" as const, text: "/plan review", mentions: [] }];

    expect(
      promptInputHasCommandMention(input, { trigger: "/", name: "plan" }),
    ).toBe(false);
    expect(
      removeCommandMentionsFromPromptInput(input, {
        trigger: "/",
        name: "plan",
      }),
    ).toEqual(input);
  });
});
