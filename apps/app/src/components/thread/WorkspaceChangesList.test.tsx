// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceChangesList,
  type WorkspaceChangedFile,
} from "./WorkspaceChangesList";

function makeFiles(count: number): WorkspaceChangedFile[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `dist/output-${index}.js`,
    status: "??" as const,
    insertions: null,
    deletions: null,
  }));
}

afterEach(cleanup);

describe("WorkspaceChangesList", () => {
  it("renders every file when the status lists them all", () => {
    render(<WorkspaceChangesList files={makeFiles(3)} fileCount={3} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/more files not shown/)).toBeNull();
  });

  it("reports files the capped status omitted", () => {
    const files = makeFiles(200);
    render(<WorkspaceChangesList files={files} fileCount={200 + 1234} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(200 + 1);
    expect(
      screen.getByText(`${(1234).toLocaleString()} more files not shown`),
    ).toBeTruthy();
  });
});
