import { describe, expect, it } from "vitest";
import { GENERATED_ID_ALPHABET, GENERATED_ID_SUFFIX_LENGTH } from "@bb/domain";
import {
  resolveThreadMentionsRequestSchema,
  resolveThreadMentionsResponseSchema,
  THREAD_MENTION_RESOLVE_MAX_IDS,
} from "../src/index.js";

function validThreadId(index: number): string {
  let value = index;
  let suffix = "";
  for (let position = 0; position < GENERATED_ID_SUFFIX_LENGTH; position += 1) {
    suffix =
      GENERATED_ID_ALPHABET[value % GENERATED_ID_ALPHABET.length] + suffix;
    value = Math.floor(value / GENERATED_ID_ALPHABET.length);
  }
  return `thr_${suffix}`;
}

describe("thread mention resolution contract", () => {
  it("rejects any request array beyond the bounded ID cap", () => {
    const oneId = validThreadId(1);
    expect(
      resolveThreadMentionsRequestSchema.safeParse({
        threadIds: Array.from(
          { length: THREAD_MENTION_RESOLVE_MAX_IDS + 1 },
          () => oneId,
        ),
      }).success,
    ).toBe(false);

    expect(
      resolveThreadMentionsRequestSchema.safeParse({
        threadIds: Array.from(
          { length: THREAD_MENTION_RESOLVE_MAX_IDS },
          (_, index) => validThreadId(index),
        ),
      }).success,
    ).toBe(true);
    expect(
      resolveThreadMentionsRequestSchema.safeParse({
        threadIds: Array.from(
          { length: THREAD_MENTION_RESOLVE_MAX_IDS + 1 },
          (_, index) => validThreadId(index),
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects IDs outside the generated raw thread-ID grammar", () => {
    expect(
      resolveThreadMentionsRequestSchema.safeParse({
        threadIds: ["thr_legacy", "proj_23456789ab"],
      }).success,
    ).toBe(false);
  });

  it("accepts only complete mention resources", () => {
    expect(
      resolveThreadMentionsResponseSchema.parse([
        {
          threadId: validThreadId(1),
          projectId: "proj_example",
          label: "Thread label",
        },
      ]),
    ).toHaveLength(1);
    expect(
      resolveThreadMentionsResponseSchema.safeParse([
        { threadId: validThreadId(1), projectId: "proj_example", label: "" },
      ]).success,
    ).toBe(false);
  });
});
