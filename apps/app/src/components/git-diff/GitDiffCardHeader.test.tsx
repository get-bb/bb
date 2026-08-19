// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GitDiffCardHeader } from "./GitDiffCardHeader";

afterEach(cleanup);

describe("GitDiffCardHeader", () => {
  it("keeps the displayed file path selectable as its own content boundary", () => {
    render(
      <GitDiffCardHeader
        model={{
          label: "src/selection.ts",
          path: "src/selection.ts",
          openablePath: "src/selection.ts",
          changeKind: "modified",
          insertions: 2,
          deletions: 1,
        }}
        previousPath={null}
        hasChanges
      />,
    );

    const path = screen.getByTitle("src/selection.ts");
    expect(path.closest(".select-text")).not.toBeNull();
    expect(path.closest("[data-select-all-scope]")).not.toBeNull();
  });
});
