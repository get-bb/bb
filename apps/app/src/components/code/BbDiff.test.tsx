// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defaultResolvedCodeTheme } from "@bb/domain";
import { applyResolvedCodeTheme } from "@/lib/code-theme";
import { parseGitDiffFiles } from "@/components/git-diff/git-diff-parsing";
import { BbDiff, type BbDiffDependencies, type BbDiffRenderer } from "./BbDiff";
import { FileDiff } from "@pierre/diffs/react";
import { processFile as pierreProcessFile } from "@pierre/diffs";

interface PierreTestState {
  lastOptions: {
    theme: { dark: string; light: string };
    diffStyle?: string;
    overflow?: string;
    disableLineNumbers?: boolean;
    disableFileHeader?: boolean;
    expansionLineCount?: number;
  } | null;
  lastFileDiff: ComponentProps<typeof FileDiff>["fileDiff"] | null;
  processFileCalls: number;
}

const pierre: PierreTestState = {
  lastOptions: null,
  lastFileDiff: null,
  processFileCalls: 0,
} satisfies PierreTestState;

function TestDiffView({ fileDiff, options }: ComponentProps<BbDiffRenderer>) {
  pierre.lastFileDiff = fileDiff;
  if (options === undefined || !("theme" in options)) {
    pierre.lastOptions = null;
    return <div data-testid="pierre-file-diff" />;
  }
  const theme = z
    .object({ dark: z.string(), light: z.string() })
    .safeParse(options?.theme);
  if (!theme.success) {
    pierre.lastOptions = null;
  } else {
    const nextOptions: NonNullable<PierreTestState["lastOptions"]> = {
      theme: theme.data,
      diffStyle: options.diffStyle,
      overflow: options.overflow,
      disableLineNumbers: options.disableLineNumbers,
      disableFileHeader: options.disableFileHeader,
    };
    if (options.expansionLineCount !== undefined) {
      nextOptions.expansionLineCount = options.expansionLineCount;
    }
    pierre.lastOptions = nextOptions;
  }
  return <div data-testid="pierre-file-diff" />;
}

const testDependencies: BbDiffDependencies = {
  DiffView: TestDiffView,
  processFile: (...args) => {
    pierre.processFileCalls += 1;
    return pierreProcessFile(...args);
  },
};

function TestBbDiff(props: ComponentProps<typeof BbDiff>) {
  return <BbDiff {...props} dependencies={testDependencies} />;
}

const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
  "",
].join("\n");

const FULL_FILE_CONTENTS = {
  old: {
    path: "src/app.ts",
    content: [
      "const a = 1;",
      "const b = 2;",
      "const c = 4;",
      "const oldTail = true;",
      "",
    ].join("\n"),
  },
  new: {
    path: "src/app.ts",
    content: [
      "const a = 1;",
      "const b = 3;",
      "const c = 4;",
      "const newTail = true;",
      "",
    ].join("\n"),
  },
};

function fixture() {
  const file = parseGitDiffFiles(PATCH)[0];
  if (file === undefined) throw new Error("fixture patch did not parse");
  return file;
}

beforeEach(() => {
  pierre.lastOptions = null;
  pierre.lastFileDiff = null;
  pierre.processFileCalls = 0;
  applyResolvedCodeTheme(defaultResolvedCodeTheme);
});

afterEach(() => {
  cleanup();
  applyResolvedCodeTheme(defaultResolvedCodeTheme);
  vi.clearAllMocks();
});

describe("BbDiff", () => {
  it("follows the resolved code theme without any consumer watching the DOM", async () => {
    render(
      <TestBbDiff
        file={fixture()}
        view="unified"
        overflow="scroll"
        showLineNumbers
        fullFileContents={null}
      />,
    );
    await screen.findByTestId("pierre-file-diff");
    expect(pierre.lastOptions?.theme.dark).toBe(defaultResolvedCodeTheme.dark);

    act(() => {
      applyResolvedCodeTheme({
        dark: "custom-dark",
        light: "custom-light",
        files: {},
      });
    });

    expect(pierre.lastOptions?.theme).toEqual({
      dark: "custom-dark",
      light: "custom-light",
    });
  });

  it("omits the expansion budget unless the caller can supply file contents", async () => {
    render(
      <TestBbDiff
        file={fixture()}
        view="unified"
        overflow="scroll"
        showLineNumbers
        fullFileContents={null}
      />,
    );
    await screen.findByTestId("pierre-file-diff");

    expect(pierre.lastOptions).not.toBeNull();
    expect("expansionLineCount" in (pierre.lastOptions ?? {})).toBe(false);
  });

  it("enriches matching full contents and enables context expansion", async () => {
    render(
      <TestBbDiff
        file={fixture()}
        patchText={PATCH}
        view="unified"
        overflow="scroll"
        showLineNumbers
        fullFileContents={FULL_FILE_CONTENTS}
      />,
    );
    await screen.findByTestId("pierre-file-diff");

    expect(pierre.lastOptions?.expansionLineCount).toBe(30);
    expect(pierre.lastFileDiff).toMatchObject({
      isPartial: false,
      additionLines: expect.arrayContaining(["const newTail = true;\n"]),
    });
  });

  it("rejects full contents that do not match the patch", async () => {
    const file = fixture();
    render(
      <TestBbDiff
        file={file}
        patchText={PATCH}
        view="unified"
        overflow="scroll"
        showLineNumbers
        fullFileContents={{
          old: { path: "src/app.ts", content: "not the old file\n" },
          new: { path: "src/app.ts", content: "not the new file\n" },
        }}
      />,
    );
    await screen.findByTestId("pierre-file-diff");

    expect(pierre.lastFileDiff).toBe(file);
    expect(pierre.lastOptions).not.toHaveProperty("expansionLineCount");
  });

  it("does not reparse when a new wrapper carries the same primitive contents", async () => {
    const file = fixture();
    const { rerender } = render(
      <TestBbDiff
        file={file}
        patchText={PATCH}
        view="unified"
        overflow="scroll"
        showLineNumbers
        fullFileContents={FULL_FILE_CONTENTS}
      />,
    );
    await screen.findByTestId("pierre-file-diff");
    const firstResolvedFile = pierre.lastFileDiff;
    expect(pierre.processFileCalls).toBe(1);

    rerender(
      <TestBbDiff
        file={file}
        patchText={PATCH}
        view="unified"
        overflow="scroll"
        showLineNumbers
        fullFileContents={{
          old: { ...FULL_FILE_CONTENTS.old },
          new: { ...FULL_FILE_CONTENTS.new },
        }}
      />,
    );

    expect(pierre.lastFileDiff).toBe(firstResolvedFile);
    expect(pierre.processFileCalls).toBe(1);
  });

  it("maps semantic presentation onto the renderer's options", async () => {
    render(
      <TestBbDiff
        file={fixture()}
        view="split"
        overflow="wrap"
        showLineNumbers={false}
        fullFileContents={null}
      />,
    );
    await screen.findByTestId("pierre-file-diff");

    expect(pierre.lastOptions?.diffStyle).toBe("split");
    expect(pierre.lastOptions?.overflow).toBe("wrap");
    expect(pierre.lastOptions?.disableLineNumbers).toBe(true);
    expect(pierre.lastOptions?.disableFileHeader).toBe(true);
  });
});
