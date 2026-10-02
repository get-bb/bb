import { describe, expect, it } from "vitest";
import {
  extractShellCommandFromString,
  parseShellCommandIntents,
} from "../src/tool-call-parsing.js";

describe("tool-call shell parsing", () => {
  it("treats quoted shell operators as literal arguments", () => {
    expect(parseShellCommandIntents('grep "a|b" "src > docs.txt"')).toEqual([
      {
        type: "search",
        cmd: 'grep "a|b" "src > docs.txt"',
        query: "a|b",
        path: "src > docs.txt",
      },
    ]);
    expect(parseShellCommandIntents('cat ">"')).toEqual([
      {
        type: "read",
        cmd: 'cat ">"',
        name: "cat",
        path: ">",
      },
    ]);
  });

  it("disqualifies commands with unquoted write redirects", () => {
    expect(parseShellCommandIntents("cat src/app.ts > /tmp/out.txt")).toEqual(
      [],
    );
  });

  it.each([
    "rg value src && cat > output.txt <<'EOF'\nvalue\nEOF",
    "cat src.ts | tee output.txt; rg value src",
    "rg value src || sed -i s/a/b/ src.ts",
    "rg value src\ncat src.ts &>> output.txt",
    "rg value src; cat src.ts 1>| output.txt",
    "rg value src; cat <> output.txt",
  ])("lets a later write disqualify an earlier read: %s", (command) => {
    expect(parseShellCommandIntents(command)).toEqual([]);
  });

  it.each([
    "rg value src; cat '<' '>' '&&' '|'",
    "rg value src && cat < input.txt 2> errors.txt",
    "rg value src; cat > /dev/null",
    "rg value src; cat <<< 'words'",
    "rg value src; cat <(printf words)",
    "rg value src; printf '%s' '$(cat > output.txt)'",
    'rg value src; printf "%s" "`cat > output.txt`"',
    "rg value src; cat \\> \\|",
    "rg value src; cat 'line one\nline two'",
    "rg value src; cat unfinished\\",
  ])("retains the first intent through non-writing suffixes: %s", (command) => {
    expect(parseShellCommandIntents(command)).toEqual([
      { type: "search", cmd: command, query: "value", path: "src" },
    ]);
  });

  it("unwraps known shell wrappers before intent parsing", () => {
    const command = extractShellCommandFromString(
      '/bin/zsh -lc "grep \\"a|b\\" src/app.ts"',
    );

    expect(command).toBe('grep "a|b" src/app.ts');
    expect(parseShellCommandIntents(command)).toEqual([
      {
        type: "search",
        cmd: 'grep "a|b" src/app.ts',
        query: "a|b",
        path: "src/app.ts",
      },
    ]);
  });

  it("treats unquoted newlines as shell segment boundaries", () => {
    const command =
      "git ls-tree -d main packages/ | head -30\n" +
      'echo "==="\n' +
      "git show main:.gitignore 2>/dev/null | grep -E 'legacy-audit|timeline-replay' || echo \"(no matches)\"";

    expect(parseShellCommandIntents(command)).toEqual([
      {
        type: "search",
        cmd: command,
        query: "legacy-audit|timeline-replay",
        path: null,
      },
    ]);
  });
});
