// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { useFileTree } from "@pierre/trees/react";
import { BbHttpError } from "@bb/sdk/browser";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceFileTree } from "./WorkspaceFileTree";

afterEach(cleanup);

function provisioningError(): BbHttpError {
  return new BbHttpError({
    status: 409,
    code: "environment_not_ready",
    message: "Environment unavailable",
    body: {
      code: "environment_not_ready",
      message: "Environment unavailable",
      details: {
        environmentStatus: "provisioning",
        hasPath: false,
      },
    },
  });
}

function WorkspaceFileTreeWithError({ error }: { error: Error }) {
  const { model } = useFileTree({
    density: "compact",
    flattenEmptyDirectories: false,
    initialExpansion: "closed",
    paths: [],
    search: false,
  });

  return (
    <WorkspaceFileTree
      controller={{
        error,
        isLoading: false,
        model,
        refresh: () => {},
      }}
    />
  );
}

describe("WorkspaceFileTree", () => {
  it("renders a preparing message instead of the provisioning HTTP error", () => {
    render(<WorkspaceFileTreeWithError error={provisioningError()} />);

    expect(screen.getByText("Preparing worktree...")).toBeTruthy();
    expect(screen.queryByText(/HTTP 409/u)).toBeNull();
    expect(
      screen.getByText("Preparing worktree...").parentElement?.className,
    ).toContain("p-3");
  });
});
