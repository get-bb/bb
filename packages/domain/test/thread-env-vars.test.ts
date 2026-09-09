import { describe, expect, it } from "vitest";
import {
  THREAD_ENV_VAR_NAME_MAX_CHARS,
  THREAD_ENV_VAR_VALUE_MAX_BYTES,
  THREAD_ENV_VARS_MAX_ENTRIES,
  threadEnvVarsSchema,
} from "../src/thread-env-vars.js";

describe("thread environment variables", () => {
  it("accepts portable names, empty values, and values containing equals signs", () => {
    expect(
      threadEnvVarsSchema.parse({
        MULTICA_TASK_ID: "task-123",
        EMPTY: "",
        TOKEN: "prefix=value",
      }),
    ).toEqual({
      MULTICA_TASK_ID: "task-123",
      EMPTY: "",
      TOKEN: "prefix=value",
    });
  });

  it.each([
    ["", "must not be empty"],
    ["1TOKEN", "must start with a letter or underscore"],
    ["TOKEN-NAME", "must start with a letter or underscore"],
    ["BB_THREAD_ID", "reserved BB_ prefix"],
    ["A".repeat(THREAD_ENV_VAR_NAME_MAX_CHARS + 1), "at most 128 characters"],
  ])("rejects the variable name %j", (name, message) => {
    expect(() => threadEnvVarsSchema.parse({ [name]: "value" })).toThrow(
      message,
    );
  });

  it("bounds values by UTF-8 bytes and rejects null bytes", () => {
    expect(
      threadEnvVarsSchema.parse({
        VALUE: "é".repeat(THREAD_ENV_VAR_VALUE_MAX_BYTES / 2),
      }),
    ).toBeDefined();
    expect(() =>
      threadEnvVarsSchema.parse({
        VALUE: `ok\0bad`,
      }),
    ).toThrow("must not contain a null byte");
    expect(() =>
      threadEnvVarsSchema.parse({
        VALUE: "é".repeat(THREAD_ENV_VAR_VALUE_MAX_BYTES / 2 + 1),
      }),
    ).toThrow("must be at most 16384 UTF-8 bytes");
  });

  it("bounds the entry count and serialized map size", () => {
    const maximumEntries = Object.fromEntries(
      Array.from({ length: THREAD_ENV_VARS_MAX_ENTRIES }, (_, index) => [
        `VALUE_${index}`,
        "value",
      ]),
    );
    expect(threadEnvVarsSchema.parse(maximumEntries)).toEqual(maximumEntries);
    expect(() =>
      threadEnvVarsSchema.parse({
        ...maximumEntries,
        TOO_MANY: "value",
      }),
    ).toThrow("must contain at most 32 entries");
    expect(() =>
      threadEnvVarsSchema.parse({
        VALUE_1: "a".repeat(THREAD_ENV_VAR_VALUE_MAX_BYTES),
        VALUE_2: "a".repeat(THREAD_ENV_VAR_VALUE_MAX_BYTES),
        VALUE_3: "a".repeat(THREAD_ENV_VAR_VALUE_MAX_BYTES),
        VALUE_4: "a".repeat(THREAD_ENV_VAR_VALUE_MAX_BYTES),
      }),
    ).toThrow("must be at most 65536 UTF-8 bytes when serialized");
  });
});
