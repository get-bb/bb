import { describe, expect, it } from "vitest";
import { extractErrorMessage, toRecord } from "../src/unknown-helpers.js";

describe("unknown helpers", () => {
  it("keeps the original error object and its prototype fields", () => {
    const error = new Error("request failed");
    const record = toRecord(error);

    expect(record).toBe(error);
    expect(record?.message).toBe("request failed");
  });

  it("stops when legacy error details contain a cycle", () => {
    const detail: { detail?: object } = {};
    detail.detail = detail;

    expect(extractErrorMessage({ detail })).toBeNull();
  });

  it("keeps boolean and number fields on boundary records", () => {
    const value = { enabled: true, attempt: 2 };

    expect(toRecord(value)).toBe(value);
    expect(toRecord(value)?.enabled).toBe(true);
    expect(toRecord(value)?.attempt).toBe(2);
  });
});
