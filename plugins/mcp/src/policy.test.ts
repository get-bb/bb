import { describe, expect, it } from "vitest";
import {
  evaluateCliAccess,
  READ_ONLY_BUNDLED_PLUGIN_COMMAND_PATHS,
  READ_ONLY_COMMAND_PATHS,
} from "./policy.js";

const KNOWN_PATHS = new Set([
  "status",
  "guide",
  "thread list",
  "thread show",
  "thread tell",
  "thread spawn",
  "thread delete",
  "thread options",
  "thread queue list",
  "thread queue send",
  "environment diff",
  "environment diff-file",
  "environment commit",
  "file read",
  "file write",
  "terminal attach",
  "terminal send",
  "terminal output",
  "plugin run",
  "plugin token",
  "plugin dev",
  "settings keyboard hints",
  "machine env list",
  "machine env set",
  "project branches",
  "environment branches",
  "plugin outdated",
  "settings usage",
  "updates app status",
  "browser watch",
  "server export",
]);

function allowed(argv: string[], mode: "read" | "write"): boolean {
  return evaluateCliAccess(argv, mode, KNOWN_PATHS).allowed;
}

describe("evaluateCliAccess in read mode", () => {
  it.each([
    [["status", "--json"]],
    [["thread", "list", "--project", "prj_1", "--json"]],
    [["thread", "show", "thr_1", "--json"]],
    [["thread", "queue", "list"]],
    [["environment", "diff", "env_1", "--target", "head"]],
    [["environment", "diff-file", "env_1", "--path", "src/a.ts"]],
    [["file", "read", "/etc/hostname"]],
    [["terminal", "output", "term_1"]],
    [["machine", "env", "list"]],
    [["guide"]],
    [["guide", "commands", "thread", "--json"]],
    [["--version"]],
    [["git", "status", "env_1", "--json"]],
    [["git", "diff", "env_1", "--target", "uncommitted"]],
    [["git", "viewed", "list", "env_1"]],
    [["git", "patch", "--help"]],
  ])("allows %j", (argv) => {
    expect(allowed(argv, "read")).toBe(true);
  });

  it.each([
    [["thread", "tell", "thr_1", "hello"]],
    [["thread", "spawn", "--prompt", "do it"]],
    [["thread", "delete", "thr_1", "--yes"]],
    [["thread", "options", "thr_1", "--set", "a=b"]],
    [["thread", "queue", "send", "q_1"]],
    [["environment", "commit", "env_1"]],
    [["file", "write", "/tmp/x"]],
    [["terminal", "send", "term_1", "rm -rf /"]],
    [["plugin", "token", "docs"]],
    [["plugin", "run", "docs", "list"]],
    [["machine", "env", "set", "KEY=value"]],
    [["settings", "keyboard", "hints", "off"]],
    [["project", "branches", "prj_1"]],
    [["environment", "branches", "env_1"]],
    [["plugin", "outdated"]],
    [["settings", "usage"]],
    [["updates", "app", "status"]],
    [["thread"]],
    [["docs", "list"]],
    [["unknown-plugin-command"]],
    [[]],
  ])("refuses %j", (argv) => {
    expect(allowed(argv, "read")).toBe(false);
  });

  it("refuses aliases, which a plugin could shadow", () => {
    expect(allowed(["threads", "list"], "read")).toBe(false);
    expect(allowed(["thread", "get", "thr_1"], "read")).toBe(false);
    expect(allowed(["env", "diff", "env_1"], "read")).toBe(false);
  });

  it("refuses an allowed command reached through leading options", () => {
    expect(allowed(["--json", "thread", "list"], "read")).toBe(false);
    expect(allowed(["thread", "--json", "delete", "thr_1"], "read")).toBe(
      false,
    );
  });

  it("allows help only for a known command path with nothing else", () => {
    expect(allowed(["thread", "tell", "--help"], "read")).toBe(true);
    expect(allowed(["thread", "--help"], "read")).toBe(true);
    expect(allowed(["--help"], "read")).toBe(true);
    expect(allowed(["thread", "tell", "thr_1", "--help"], "read")).toBe(false);
    expect(allowed(["terminal", "send", "term_1", "--help"], "read")).toBe(
      false,
    );
    expect(allowed(["thread", "tell", "thr_1", "--", "--help"], "read")).toBe(
      false,
    );
    expect(allowed(["docs", "--help"], "read")).toBe(false);
  });
});

describe("READ_ONLY_COMMAND_PATHS", () => {
  it("lists exactly the commands reviewed as changing nothing", () => {
    expect([...READ_ONLY_COMMAND_PATHS].sort()).toEqual([
      "environment diff",
      "environment diff-file",
      "environment diff-files",
      "environment diff-patch",
      "environment list",
      "environment paths",
      "environment providers",
      "environment show",
      "environment status",
      "file list",
      "file paths",
      "file read",
      "guide",
      "machine env list",
      "machine list",
      "machine provider-cli status",
      "machine providers",
      "machine show",
      "marketplace list",
      "plugin install-jobs",
      "plugin list",
      "plugin rpc inspect",
      "plugin rpc list",
      "plugin search",
      "plugin update-jobs",
      "project commands",
      "project content",
      "project files",
      "project history",
      "project list",
      "project paths",
      "project show",
      "prompt-history list",
      "provider list",
      "provider models",
      "pull-request show",
      "settings ai-services show",
      "settings keyboard list",
      "settings show",
      "settings ui get",
      "settings ui list",
      "settings version",
      "skill cli-skills-status",
      "skill files",
      "skill list",
      "skill registry detail",
      "skill search",
      "skill show",
      "status",
      "terminal list",
      "terminal output",
      "terminal show",
      "theme list",
      "theme show",
      "thread commands",
      "thread context",
      "thread count",
      "thread history",
      "thread interactions list",
      "thread interactions show",
      "thread list",
      "thread log",
      "thread output",
      "thread queue list",
      "thread search",
      "thread section list",
      "thread show",
      "thread tabs show",
      "thread wait",
      "updates status",
    ]);
  });
});

describe("evaluateCliAccess in write mode", () => {
  it.each([
    [["thread", "tell", "thr_1", "hello"]],
    [["file", "write", "/tmp/x"]],
    [["docs", "list"]],
    [["plugin", "run", "docs", "list"]],
    [["threads", "list"]],
  ])("allows %j", (argv) => {
    expect(allowed(argv, "write")).toBe(true);
  });

  it.each([
    [["terminal", "attach", "term_1"]],
    [["plugin", "dev"]],
    [["plugins", "dev"]],
    [["browser", "watch"]],
  ])("refuses %j, which cannot run over MCP", (argv) => {
    expect(allowed(argv, "write")).toBe(false);
    expect(allowed(argv, "read")).toBe(false);
  });

  it.each([
    [["server", "export", "/tmp/backup"]],
    [["machine", "enroll"]],
    [["plugin", "new", "demo"]],
    [["mcp", "revoke", "grant_1"]],
  ])("allows %j", (argv) => {
    expect(allowed(argv, "write")).toBe(true);
  });

  it("refuses oversized or malformed argument lists", () => {
    expect(allowed(new Array(65).fill("x"), "write")).toBe(false);
    expect(allowed(["thread", "tell", "a\0b"], "write")).toBe(false);
    expect(allowed(["thread", "tell", "x".repeat(200_001)], "write")).toBe(
      false,
    );
  });
});

describe("READ_ONLY_BUNDLED_PLUGIN_COMMAND_PATHS", () => {
  it("lists the Git plugin's commands that change nothing", () => {
    expect([...READ_ONLY_BUNDLED_PLUGIN_COMMAND_PATHS].sort()).toEqual([
      "git branches",
      "git diff",
      "git file",
      "git files",
      "git patch",
      "git status",
      "git viewed list",
    ]);
  });

  it("denies the Git plugin's writes in read mode", () => {
    expect(allowed(["git", "viewed", "mark", "env_1"], "read")).toBe(false);
    expect(allowed(["git", "viewed", "clear", "env_1"], "read")).toBe(false);
  });
});
