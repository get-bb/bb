// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultResolvedCodeTheme } from "@bb/domain";
import { applyResolvedCodeTheme } from "@/lib/code-theme";
import { parseGitDiffFiles } from "@/components/git-diff/git-diff-parsing";
import { BbDiff } from "./BbDiff";

interface RenderedOptions {
  theme: { dark: string; light: string };
  diffStyle: string;
  overflow: string;
  disableLineNumbers: boolean;
  disableFileHeader: boolean;
}

const pierre = vi.hoisted(() => ({
  lastOptions: null as RenderedOptions | null,
}));

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");
  return {
    FileDiff: ({ options }: { options: RenderedOptions }) => {
      pierre.lastOptions = options;
      return React.createElement("div", { "data-testid": "pierre-file-diff" });
    },
  };
});

const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,2 @@",
  "-const b = 2;",
  "+const b = 3;",
  "",
].join("\n");

function fixture() {
  const file = parseGitDiffFiles(PATCH)[0];
  if (file === undefined) throw new Error("fixture patch did not parse");
  return file;
}

beforeEach(() => {
  pierre.lastOptions = null;
  applyResolvedCodeTheme(defaultResolvedCodeTheme);
});

afterEach(() => {
  cleanup();
  applyResolvedCodeTheme(defaultResolvedCodeTheme);
  vi.restoreAllMocks();
});

describe("BbDiff", () => {
  it("follows the resolved code theme without any consumer watching the DOM", async () => {
    render(
      <BbDiff
        file={fixture()}
        view="unified"
        overflow="scroll"
        showLineNumbers
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

  it("maps semantic presentation onto the renderer's options", async () => {
    render(
      <BbDiff
        file={fixture()}
        view="split"
        overflow="wrap"
        showLineNumbers={false}
      />,
    );
    await screen.findByTestId("pierre-file-diff");

    expect(pierre.lastOptions?.diffStyle).toBe("split");
    expect(pierre.lastOptions?.overflow).toBe("wrap");
    expect(pierre.lastOptions?.disableLineNumbers).toBe(true);
    // The card header owns the file name; the renderer must never draw a second.
    expect(pierre.lastOptions?.disableFileHeader).toBe(true);
  });
});
