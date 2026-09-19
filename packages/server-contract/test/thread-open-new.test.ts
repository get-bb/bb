import { describe, expect, it } from "vitest";
import {
  changedMessageLenientSchema,
  threadOpenNewRequestSchema,
  threadOpenNewSignalLenientSchema,
  threadOpenNewSignalSchema,
  threadOpenRequestSchema,
  threadOpenSignalLenientSchema,
  threadOpenSignalSchema,
} from "../src/index.js";

describe("new-thread open contracts", () => {
  it("accepts omitted placement and rejects unsupported request fields", () => {
    expect(threadOpenNewRequestSchema.parse({})).toEqual({});
    expect(threadOpenNewRequestSchema.parse({ split: "left" })).toEqual({
      split: "left",
    });
    for (const input of [
      { split: "diagonal" },
      { threadId: "thr_1" },
      { file: null },
    ]) {
      expect(threadOpenNewRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it("uses a distinct lenient signal without changing legacy open contracts", () => {
    const signal = { type: "thread-open-new", split: "right" };
    expect(threadOpenNewSignalSchema.parse(signal)).toEqual(signal);
    expect(
      threadOpenNewSignalLenientSchema.parse({ ...signal, future: true }),
    ).toEqual(signal);
    expect(threadOpenSignalLenientSchema.safeParse(signal).success).toBe(false);
    expect(changedMessageLenientSchema.safeParse(signal).success).toBe(false);

    const legacySignal = {
      type: "thread-open",
      projectId: "proj_1",
      threadId: "thr_1",
      split: "replace",
      file: null,
    };
    expect(threadOpenRequestSchema.parse({ file: null })).toEqual({
      file: null,
    });
    expect(threadOpenSignalSchema.parse(legacySignal)).toEqual(legacySignal);
    expect(
      threadOpenSignalLenientSchema.parse({ ...legacySignal, future: true }),
    ).toEqual(legacySignal);
    expect(
      threadOpenNewSignalLenientSchema.safeParse(legacySignal).success,
    ).toBe(false);
  });
});
