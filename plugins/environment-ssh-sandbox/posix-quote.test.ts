import { describe, expect, it } from "vitest";
import { posixCommand, posixQuote } from "./posix-quote.js";

describe("posix quoting", () => {
  it("wraps a plain token in single quotes", () => {
    expect(posixQuote("sh")).toBe("'sh'");
  });

  it("escapes embedded single quotes so a POSIX shell reconstructs the value", () => {
    expect(posixQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("joins argv into one remote command", () => {
    expect(posixCommand(["sh", "-c", "echo hi"])).toBe("'sh' '-c' 'echo hi'");
  });

  it("rejects an empty command", () => {
    expect(() => posixCommand([])).toThrow("SSH remote command is empty");
  });
});
