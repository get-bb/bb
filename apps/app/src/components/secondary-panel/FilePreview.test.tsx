// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilePreview } from "./FilePreview";

describe("FilePreview", () => {
  it("renders ready source preview text directly in the DOM", () => {
    render(
      <FilePreview
        path="src/index.ts"
        state={{
          kind: "ready",
          file: {
            name: "index.ts",
            contents: "export const value = 1;\nconsole.log(value);",
          },
          lineRange: null,
          showMarkdownModeToggle: false,
        }}
      />,
    );

    expect(screen.getByText("export const value = 1;")).toBeTruthy();
    expect(screen.getByText("console.log(value);")).toBeTruthy();
  });
});
