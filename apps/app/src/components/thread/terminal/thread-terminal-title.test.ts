import { describe, expect, it } from "vitest";
import { normalizeTerminalTitle } from "./thread-terminal-title";

describe("terminal title normalization", () => {
  it("returns null for blank titles", () => {
    expect(normalizeTerminalTitle({ title: "  " })).toBeNull();
  });

  it("trims ordinary titles without changing their content", () => {
    expect(normalizeTerminalTitle({ title: "  Edited title  " })).toBe(
      "Edited title",
    );
  });

  it("ignores shell path titles without changing the terminal title", () => {
    expect(
      normalizeTerminalTitle({
        title:
          "michael@Michaels-MacBook-Pro:~/.bb-dev/worktrees/env_gj4ep9emi8/bb",
      }),
    ).toBeNull();
  });

  it("ignores shell path titles with whitespace after the host separator", () => {
    expect(
      normalizeTerminalTitle({
        title: "root@do-1: ~/.bb/worktrees/env_4gfkk8evua/bb",
      }),
    ).toBeNull();
  });

  it("ignores short shell path titles", () => {
    expect(
      normalizeTerminalTitle({
        title: "michael@host:~/bb",
      }),
    ).toBeNull();
  });
});
