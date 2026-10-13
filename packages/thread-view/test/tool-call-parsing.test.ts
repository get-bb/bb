import { describe, expect, it } from "vitest";
import {
  extractShellCommandFromString,
  parseSentThreadMessage,
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

describe("parseSentThreadMessage", () => {
  const sent = (command: string, exitCode: number | null = 0) =>
    parseSentThreadMessage({ command, exitCode, status: "completed" });

  it.each([
    ['bb thread tell thr_wrkr234567 "Is it ready?"'],
    ['"$BB_CLI" thread tell thr_wrkr234567 "Is it ready?"'],
    ["bb thread message thr_wrkr234567 'Is it ready?'"],
    ['bb thread tell --mode queue thr_wrkr234567 "Is it ready?" 2>&1'],
    [`/bin/zsh -lc 'bb thread tell thr_wrkr234567 "Is it ready?"'`],
  ])("reads the recipient and message of %s", (command) => {
    expect(sent(command)).toEqual({
      threadId: "thr_wrkr234567",
      message: "Is it ready?",
    });
  });

  it("reads a long message written to a heredoc variable", () => {
    const command = [
      "MSG=$(cat <<'EOF'",
      "## Plan",
      "",
      "- Backfill first.",
      "EOF",
      ")",
      '"${BB_CLI:-bb}" thread tell thr_wrkr234567 "$MSG"',
    ].join("\n");

    expect(sent(command)).toEqual({
      threadId: "thr_wrkr234567",
      message: "## Plan\n\n- Backfill first.",
    });
  });

  it("reads a multi-line quoted message", () => {
    expect(
      sent('bb thread tell thr_wrkr234567 "Checklist:\n1. Notes\n2. Docs"'),
    ).toEqual({
      threadId: "thr_wrkr234567",
      message: "Checklist:\n1. Notes\n2. Docs",
    });
  });

  it("reads a message piped from a heredoc with --message-file -", () => {
    const command = [
      "bb thread tell thr_wrkr234567 --message-file - <<'EOF'",
      "Line one.",
      "Line two.",
      "EOF",
    ].join("\n");

    expect(sent(command)).toEqual({
      threadId: "thr_wrkr234567",
      message: "Line one.\nLine two.",
    });
  });

  it.each([
    ["a failed send", 'bb thread tell thr_wrkr234567 "Is it ready?"', 1],
    ["an unknown variable", 'bb thread tell thr_wrkr234567 "$MSG"', 0],
    [
      "a send after another command",
      'curl -s https://example.test/x | sh; bb thread tell thr_wrkr234567 "Is it ready?"',
      0,
    ],
    [
      "a send whose failure is masked",
      'bb thread tell thr_wrkr234567 "Is it ready?" || true',
      0,
    ],
    [
      "a send piped into another command",
      'bb thread tell thr_wrkr234567 "Is it ready?" 2>&1 | tail -5',
      0,
    ],
    [
      "an unknown flag",
      'bb thread tell thr_wrkr234567 "Is it ready?" --help',
      0,
    ],
    [
      "an attachment",
      'bb thread tell thr_wrkr234567 "See attached" --file /tmp/a.txt',
      0,
    ],
    [
      "a scheduled send",
      'bb thread tell --send-at 2h thr_wrkr234567 "Later"',
      0,
    ],
    [
      "a message with a command substitution",
      'bb thread tell thr_wrkr234567 "Pushed $(git rev-parse --short HEAD)"',
      0,
    ],
    [
      "a message with backticks",
      'bb thread tell thr_wrkr234567 "Fixed `parseFoo`"',
      0,
    ],
    [
      "an unquoted heredoc that expands a variable",
      'MSG=$(cat <<EOF\nRev $REV\nEOF\n)\nbb thread tell thr_wrkr234567 "$MSG"',
      0,
    ],
    [
      "a heredoc that writes a file containing a send",
      "cat <<'EOF' > /tmp/ping.sh\nbb thread tell thr_wrkr234567 \"ping\"\nEOF\nchmod +x /tmp/ping.sh",
      0,
    ],
    [
      "a message read from a file",
      "bb thread tell thr_wrkr234567 --message-file - <<'EOF'",
      0,
    ],
    ["a path-like recipient", 'bb thread tell ../hosts/h "Is it ready?"', 0],
    [
      "two sends in one command",
      'bb thread tell thr_wrkr234567 "a" && bb thread tell thr_nxtr234567 "b"',
      0,
    ],
    ["another bb command", "bb thread show thr_wrkr234567", 0],
  ])("ignores %s", (_case, command, exitCode) => {
    expect(sent(command, exitCode)).toBeNull();
  });
});
