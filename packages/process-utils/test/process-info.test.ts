import { describe, expect, it } from "vitest";
import { parseElapsedSeconds } from "../src/process-info.js";

describe("parseElapsedSeconds", () => {
  it("reads every ps etime shape", () => {
    expect(parseElapsedSeconds("00:05")).toBe(5);
    expect(parseElapsedSeconds("30:00")).toBe(1_800);
    expect(parseElapsedSeconds("2:03:04")).toBe(7_384);
    expect(parseElapsedSeconds("13-16:51:17")).toBe(1_183_877);
    expect(parseElapsedSeconds("  01:00 ")).toBe(60);
    expect(parseElapsedSeconds("nonsense")).toBeNull();
    expect(parseElapsedSeconds("")).toBeNull();
  });
});
