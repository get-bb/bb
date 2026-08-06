// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGitHubRepositoryUrl, WorkspaceGitBar } from "./WorkspaceGitBar";

afterEach(cleanup);

describe("WorkspaceGitBar", () => {
  it("does not report a missing pull request while GitHub data loads", () => {
    render(
      <WorkspaceGitBar
        onOpenUrl={vi.fn()}
        pullRequestResponse={undefined}
        repositoryUrl={null}
        workspaceStatus={undefined}
      />,
    );

    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("No pull request")).toBeNull();
  });

  it("distinguishes offline GitHub from an absent pull request", () => {
    const view = render(
      <WorkspaceGitBar
        onOpenUrl={vi.fn()}
        pullRequestResponse={{ outcome: "unavailable", message: "network" }}
        repositoryUrl={null}
        workspaceStatus={undefined}
      />,
    );
    expect(screen.getByText("Offline")).toBeTruthy();

    view.rerender(
      <WorkspaceGitBar
        onOpenUrl={vi.fn()}
        pullRequestResponse={{ outcome: "absent" }}
        repositoryUrl={null}
        workspaceStatus={undefined}
      />,
    );
    expect(screen.getByText("No pull request")).toBeTruthy();
  });

  it("opens the current commit when the branch has no pull request", () => {
    const onOpenUrl = vi.fn();
    render(
      <WorkspaceGitBar
        onOpenUrl={onOpenUrl}
        pullRequestResponse={{ outcome: "absent" }}
        repositoryUrl="https://github.com/acme/example"
        workspaceStatus={makeWorkspaceStatus({
          checkout: {
            kind: "branch",
            branchName: "feature",
            headSha: "0123456789abcdef",
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /current commit/i }));
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://github.com/acme/example/commit/0123456789abcdef",
    );
  });
});

describe("getGitHubRepositoryUrl", () => {
  it.each([
    ["git@github.com:acme/example.git", "https://github.com/acme/example"],
    ["https://github.com/acme/example.git", "https://github.com/acme/example"],
    [
      "ssh://git@github.com/acme/example.git",
      "https://github.com/acme/example",
    ],
  ])("normalises %s", (remote, expected) => {
    expect(getGitHubRepositoryUrl(remote)).toBe(expected);
  });

  it("rejects non-GitHub remotes", () => {
    expect(getGitHubRepositoryUrl("https://example.com/acme/example.git")).toBe(
      null,
    );
  });
});
