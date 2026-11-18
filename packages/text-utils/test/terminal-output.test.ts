import { describe, expect, it } from "vitest";
import {
  createTerminalOutputLineReader,
  readTerminalOutputLines,
  sanitizeTerminalOutput,
  terminalOutputToPlainText,
} from "../src/index.js";

interface TerminalOutputCase {
  name: string;
  input: string;
  expected: string;
}

const REAL_CLI_OUTPUT_CASES: TerminalOutputCase[] = [
  {
    name: "npm install spinner redrawn with CHA and EL",
    input:
      "\u001b[1G\u001b[0K⠙\u001b[1G\u001b[0K⠹\u001b[1G\u001b[0K\r\nadded 1 package in 367ms\r\n\u001b[1G\u001b[0K⠹\u001b[1G\u001b[0K",
    expected: "\nadded 1 package in 367ms\n",
  },
  {
    name: "pnpm add progress redrawn with cursor up",
    input:
      "Progress: resolved \u001b[96m1\u001b[39m, reused \u001b[96m0\u001b[39m, downloaded \u001b[96m0\u001b[39m, added \u001b[96m0\u001b[39m\r\n\u001b[1APackages: \u001b[32m+3\u001b[39m\u001b[0K\r\n\r\nProgress: resolved \u001b[96m1\u001b[39m, reused \u001b[96m0\u001b[39m, downloaded \u001b[96m0\u001b[39m, added \u001b[96m0\u001b[39m\r\n\u001b[1AProgress: resolved \u001b[96m3\u001b[39m, reused \u001b[96m1\u001b[39m, downloaded \u001b[96m2\u001b[39m, added \u001b[96m3\u001b[39m, done\r\n\r\n\u001b[96mdependencies:\u001b[39m\r\n\u001b[32m+\u001b[39m is-number \u001b[90m7.0.0\u001b[39m\r\n\r\nDone in 314ms\r\n",
    expected:
      "Packages: \u001b[32m+3\u001b[0m\n\nProgress: resolved \u001b[96m3\u001b[0m, reused \u001b[96m1\u001b[0m, downloaded \u001b[96m2\u001b[0m, added \u001b[96m3\u001b[0m, done\n\n\u001b[96mdependencies:\u001b[0m\n\u001b[32m+\u001b[0m is-number \u001b[90m7.0.0\u001b[0m\n\nDone in 314ms\n",
  },
  {
    name: "ripgrep OSC 8 hyperlinks terminated by ST",
    input:
      "\u001b]8;;file:///repo/packages/text-utils/src/utf16.ts\u001b\\\u001b[0m\u001b[35mpackages/text-utils/src/utf16.ts\u001b[0m\u001b]8;;\u001b\\\r\n\u001b[0m\u001b[32m16\u001b[0m:export function \u001b[0m\u001b[1m\u001b[31msliceUtf16Head\u001b[0m(value: string): string {\r\n",
    expected:
      "\u001b[35mpackages/text-utils/src/utf16.ts\u001b[0m\n\u001b[32m16\u001b[0m:export function \u001b[1m\u001b[31msliceUtf16Head\u001b[0m(value: string): string {\n",
  },
  {
    name: "vitest cursor visibility and synchronized output modes",
    input:
      "\u001b[?25l\r\n RUN  v4.1.12 /repo/packages/text-utils\r\n\r\n\u001b[?2026h\r\n Test Files 0 passed (3)\r\n\u001b[?2026l\u001b[K ✓ |@bb/text-utils| test/utf16.test.ts (3 tests) 2ms\r\n\r\n Test Files  3 passed (3)\r\n\u001b[?25h",
    expected:
      "\n RUN  v4.1.12 /repo/packages/text-utils\n\n\n Test Files 0 passed (3)\n ✓ |@bb/text-utils| test/utf16.test.ts (3 tests) 2ms\n\n Test Files  3 passed (3)\n",
  },
  {
    name: "git log --color under script(1), whose ^D echo is backspaced over",
    input:
      "^D\b\b* \u001b[33m02264cfe059\u001b[m\u001b[33m (\u001b[m\u001b[1;36mHEAD\u001b[m\u001b[33m -> \u001b[m\u001b[1;32mmain\u001b[m\u001b[33m, \u001b[m\u001b[1;31morigin/main\u001b[m\u001b[33m)\u001b[m Preserve Codex history (#7768)\r\n",
    expected:
      "* \u001b[33m02264cfe059 (\u001b[0m\u001b[1m\u001b[36mHEAD\u001b[0m\u001b[33m -> \u001b[0m\u001b[1m\u001b[32mmain\u001b[0m\u001b[33m, \u001b[0m\u001b[1m\u001b[31morigin/main\u001b[0m\u001b[33m)\u001b[0m Preserve Codex history (#7768)\n",
  },
];

const CONTROL_SEQUENCE_CASES: TerminalOutputCase[] = [
  {
    name: "OSC window title terminated by BEL",
    input: "\u001b]0;pnpm test\u0007ok\n",
    expected: "ok\n",
  },
  {
    name: "designate-charset escape with an intermediate byte",
    input: "a\u001b(Bb\u001b)0c\n",
    expected: "abc\n",
  },
  {
    name: "CSI with an intermediate byte drops its final byte",
    input: "\u001b[2 qcursor\n",
    expected: "cursor\n",
  },
  {
    name: "DCS, APC, PM and SOS strings",
    input:
      "\u001bP1$r0m\u001b\\a\u001b_Gi=1;AAAA\u001b\\b\u001b^pm\u001b\\c\u001bXsos\u001b\\d",
    expected: "abcd",
  },
  {
    name: "unterminated OSC ends at the next line",
    input: "\u001b]8;;https://example.com\nnext line\n",
    expected: "\nnext line\n",
  },
  {
    name: "private-parameter SGR such as modifyOtherKeys",
    input: "\u001b[>4;2mtext\u001b[>4m\n",
    expected: "text\n",
  },
  {
    name: "underline colour in semicolon form does not leak into the foreground",
    input: "\u001b[4;58;2;255;0;31mwarn\u001b[59;24m done\n",
    expected: "\u001b[4mwarn\u001b[0m done\n",
  },
  {
    name: "underline colour and style in colon form",
    input: "\u001b[4:3m\u001b[58:2::10:200:30mcurly\u001b[4:0m plain\n",
    expected: "\u001b[4mcurly\u001b[0m plain\n",
  },
  {
    name: "truecolor in colon form with and without a colour space id",
    input: "\u001b[38:2::255:0:0mred\u001b[48:2:1:2:3mbg\u001b[0m\n",
    expected:
      "\u001b[38;2;255;0;0mred\u001b[0m\u001b[38;2;255;0;0m\u001b[48;2;1;2;3mbg\u001b[0m\n",
  },
  {
    name: "256-colour palette codes combined with other attributes",
    input: "\u001b[1;38;5;196;48;5;2mx\u001b[0m\n",
    expected: "\u001b[1m\u001b[38;5;196m\u001b[42mx\u001b[0m\n",
  },
  {
    name: "unsupported SGR attributes are dropped",
    input: "\u001b[2;7;5mdim\u001b[22;27;25m\n",
    expected: "dim\n",
  },
  {
    name: "carriage return progress keeps the last frame",
    input: "Downloading  10%\rDownloading  55%\rDownloading 100%\n",
    expected: "Downloading 100%\n",
  },
  {
    name: "carriage return over a longer line overwrites only its width",
    input: "abcdef\rXY\n",
    expected: "XYcdef\n",
  },
  {
    name: "erase to start of line blanks earlier columns",
    input: "abcdef\u001b[3D\u001b[1Kx\n",
    expected: "   xef\n",
  },
  {
    name: "BEL and other C0 controls",
    input: "a\u0007b\u0000c\u007fd\te\n",
    expected: "abcd\te\n",
  },
  {
    name: "cursor forward stops at the column limit",
    input: `a\u001b[2147483647Cb\n`,
    expected: `a${" ".repeat(1023)}b\n`,
  },
  {
    name: "cursor column moves stay inside text longer than the column limit",
    input: `${"x".repeat(2000)}\u001b[1500GY\n`,
    expected: `${"x".repeat(1499)}Y${"x".repeat(500)}\n`,
  },
  {
    name: "cursor down stops at the last line",
    input: "a\nb\u001b[2147483647Bc\n",
    expected: "a\nbc\n",
  },
  {
    name: "escape sequence cut off at the end of streamed output",
    input: "done\n\u001b[3",
    expected: "done\n",
  },
];

describe("sanitizeTerminalOutput", () => {
  it.each(REAL_CLI_OUTPUT_CASES)(
    "renders real CLI output: $name",
    (testCase) => {
      expect(sanitizeTerminalOutput(testCase.input)).toBe(testCase.expected);
    },
  );

  it.each(CONTROL_SEQUENCE_CASES)("handles $name", (testCase) => {
    expect(sanitizeTerminalOutput(testCase.input)).toBe(testCase.expected);
  });

  it("returns output without control characters unchanged", () => {
    const text = "line one\n\tline two\n";
    expect(sanitizeTerminalOutput(text)).toBe(text);
  });
});

describe("terminalOutputToPlainText", () => {
  it("drops colours along with every other control sequence", () => {
    expect(
      terminalOutputToPlainText(
        "\u001b]8;;file:///repo/a.ts\u001b\\\u001b[35ma.ts\u001b[0m\u001b]8;;\u001b\\\r\n\u001b[1G\u001b[0Kdone 50%\rdone 100%\r\n",
      ),
    ).toBe("a.ts\ndone 100%\n");
  });
});

describe("terminal output line reader", () => {
  it("compacts carriage-return progress updates to the final display line", () => {
    expect(
      readTerminalOutputLines(
        [
          "Preparing worktree\n",
          "Updating files:  44% (1017/2287)\r",
          "Updating files:  45% (1030/2287)\r",
          "Updating files: 100% (2287/2287), done.\n",
        ].join(""),
      ),
    ).toEqual([
      "Preparing worktree",
      "Updating files: 100% (2287/2287), done.",
    ]);
  });

  it("preserves regular CRLF line breaks", () => {
    expect(readTerminalOutputLines("first\r\nsecond\r\n")).toEqual([
      "first",
      "second",
    ]);
  });

  it("strips escape sequences and drops lines left blank", () => {
    expect(
      readTerminalOutputLines(
        "\u001b[1G\u001b[0K⠙\u001b[1G\u001b[0K\r\n\u001b[32m+\u001b[39m is-odd\r\n",
      ),
    ).toEqual(["+ is-odd"]);
  });

  it("keeps partial lines buffered until complete or flushed", () => {
    const reader = createTerminalOutputLineReader();

    expect(reader.push("fir")).toEqual([]);
    expect(reader.push("st\nprogress 1\r")).toEqual(["first"]);
    expect(reader.push("progress done")).toEqual([]);
    expect(reader.flush()).toEqual(["progress done"]);
  });

  it("handles CRLF and escape sequences split across chunks", () => {
    const reader = createTerminalOutputLineReader();

    expect(reader.push("first\r")).toEqual([]);
    expect(reader.push("\nsec\u001b[3")).toEqual(["first"]);
    expect(reader.push("2mond\u001b[0m\r")).toEqual([]);
    expect(reader.push("\n")).toEqual(["second"]);
  });
});
