// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalComposerMentionSuggestion } from "@get-bb/plugin-sdk/app";
import { MentionMenu } from "./MentionMenu";

afterEach(cleanup);

describe("MentionMenu", () => {
  it("shows a refresh spinner over current results without changing their layout", () => {
    const suggestion: ExperimentalComposerMentionSuggestion = {
      kind: "path",
      key: "src/index.ts",
      text: "src/index.ts",
      mention: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "src/index.ts",
        label: "index.ts",
      },
    };
    const renderMenu = (refreshing: boolean) =>
      render(
        <MentionMenu
          state={{
            trigger: "mention",
            state: {
              kind: "results",
              refreshing,
              groups: [
                {
                  key: "workspace",
                  label: "Workspace",
                  suggestions: [suggestion],
                },
              ],
            },
          }}
          selectedIndex={0}
          onApply={vi.fn()}
        />,
      );

    const idle = renderMenu(false);
    const idleStatus = idle.container.querySelector("[role='status']");
    expect(idleStatus?.classList.contains("invisible")).toBe(true);
    expect(screen.queryByLabelText("Updating results")).toBeNull();
    idle.unmount();

    const refreshing = renderMenu(true);
    const refreshingStatus =
      refreshing.container.querySelector("[role='status']");
    expect(refreshingStatus?.classList.contains("invisible")).toBe(false);
    expect(screen.getByLabelText("Updating results")).toBe(refreshingStatus);
    expect(screen.getByText("index.ts")).not.toBeNull();
  });

  it("numbers rows across groups so keyboard selection follows display order", () => {
    const path = (name: string): ExperimentalComposerMentionSuggestion => ({
      kind: "path",
      key: name,
      text: name,
      mention: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: name,
        label: name,
      },
    });
    render(
      <MentionMenu
        state={{
          trigger: "mention",
          state: {
            kind: "results",
            refreshing: false,
            groups: [
              { key: "a", label: "A", suggestions: [path("one"), path("two")] },
              { key: "b", label: "B", suggestions: [path("three")] },
            ],
          },
        }}
        selectedIndex={2}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText("three").closest("button")?.className).toContain(
      "bg-state-active",
    );
    expect(screen.getByText("two").closest("button")?.className).not.toContain(
      "bg-state-active",
    );
  });
});
