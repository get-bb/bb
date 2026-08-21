import type { TerminalSession } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  describeTerminalSessionRow,
  normalizeTerminalTitle,
  sortTerminalSessions,
} from "./terminal-session-model";

function session(overrides: Partial<TerminalSession>): TerminalSession {
  return {
    id: "term_1",
    threadId: "thr_1",
    environmentId: null,
    hostId: "host_1",
    title: "zsh",
    initialCwd: "/work",
    cols: 80,
    rows: 24,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

describe("normalizeTerminalTitle", () => {
  it("returns null for blank titles and trims ordinary ones", () => {
    expect(normalizeTerminalTitle("  ")).toBeNull();
    expect(normalizeTerminalTitle("  vim  ")).toBe("vim");
  });

  it("ignores shell path titles (user@host:path) in every spelling", () => {
    expect(
      normalizeTerminalTitle(
        "michael@Michaels-MacBook-Pro:~/.bb-dev/worktrees/env_gj4ep9emi8/bb",
      ),
    ).toBeNull();
    expect(
      normalizeTerminalTitle("root@do-1: ~/.bb/worktrees/env_4gfkk8evua/bb"),
    ).toBeNull();
    expect(normalizeTerminalTitle("michael@host:~/bb")).toBeNull();
    expect(normalizeTerminalTitle("user@host:/")).toBeNull();
  });

  it("keeps user@host titles whose suffix is not a path", () => {
    expect(normalizeTerminalTitle("user@host:htop")).toBe("user@host:htop");
  });

  it("caps the title at the route limit", () => {
    expect(normalizeTerminalTitle("x".repeat(500))).toHaveLength(200);
  });
});

describe("terminal session rows", () => {
  it("describes status and exit code, and orders live sessions newest first", () => {
    const running = session({ id: "a", createdAt: 10 });
    const older = session({ id: "b", createdAt: 5, status: "starting" });
    const exited = session({
      id: "c",
      createdAt: 20,
      status: "exited",
      exitCode: 1,
    });
    expect(describeTerminalSessionRow(exited)).toEqual({
      id: "c",
      title: "zsh",
      subtitle: "exited (code 1)",
      active: false,
    });
    expect(describeTerminalSessionRow(older).active).toBe(true);
    expect(
      sortTerminalSessions([older, exited, running]).map((entry) => entry.id),
    ).toEqual(["a", "b", "c"]);
  });
});
