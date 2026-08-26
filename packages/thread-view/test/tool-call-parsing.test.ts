import { describe, expect, it } from "vitest";
import {
  extractShellCommandFromString,
  parseShellCommandIntents,
} from "../src/tool-call-parsing.js";

describe("tool-call shell parsing", () => {
  it("keeps read and list intents for shell commands", () => {
    expect(parseShellCommandIntents('cat ">"')).toEqual([
      {
        type: "read",
        cmd: 'cat ">"',
        name: "cat",
        path: ">",
      },
    ]);
    expect(parseShellCommandIntents("ls -la src")).toEqual([
      {
        type: "list_files",
        cmd: "ls -la src",
        path: "src",
      },
    ]);
  });

  it("does not infer search intents from shell commands", () => {
    expect(parseShellCommandIntents('grep "a|b" src/app.ts')).toEqual([]);
    expect(parseShellCommandIntents("rg TODO src")).toEqual([]);

    const incidentCommand =
      "rm -f result && nix build . 2>&1 | " +
      "grep -vE '^warning|^Using saved|SQLite' | tail -3";
    expect(parseShellCommandIntents(incidentCommand)).toEqual([]);

    const multilineCommand =
      "git ls-tree -d main packages/ | head -30\n" +
      'echo "==="\n' +
      "git show main:.gitignore 2>/dev/null | " +
      "grep -E 'legacy-audit|timeline-replay' || echo \"(no matches)\"";
    expect(parseShellCommandIntents(multilineCommand)).toEqual([]);
  });

  it("disqualifies commands with unquoted write redirects", () => {
    expect(parseShellCommandIntents("cat src/app.ts > /tmp/out.txt")).toEqual(
      [],
    );
  });

  it("unwraps known shell wrappers before intent parsing", () => {
    const command = extractShellCommandFromString(
      '/bin/zsh -lc "cat src/app.ts"',
    );

    expect(command).toBe("cat src/app.ts");
    expect(parseShellCommandIntents(command)).toEqual([
      {
        type: "read",
        cmd: "cat src/app.ts",
        name: "cat",
        path: "src/app.ts",
      },
    ]);
  });
});
