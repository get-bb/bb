// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
} from "./PromptBoxInternal";

afterEach(cleanup);

it("shows a compact summary instead of the empty-editor placeholder", () => {
  const compact = {
    isCompact: true,
    placeholder: "Ask a follow-up",
    summary: <span>GPT-5</span>,
  };

  render(
    <PromptBoxInternal
      value=""
      mentionRanges={[]}
      onChange={vi.fn()}
      onSubmit={vi.fn()}
      mentionMenuPlacement="bottom"
      typeahead={{
        mention: {
          results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
          isLoading: false,
          isError: false,
          onQueryChange: vi.fn(),
        },
        command: INERT_TYPEAHEAD_COMMAND_CONFIG,
      }}
      compact={compact}
      containerCompactPlaceholder="Ask a follow-up"
    />,
  );

  const editor = document.querySelector(".ProseMirror");
  const form = document.querySelector("[data-promptbox]");
  expect(editor?.getAttribute("data-placeholder")).toBe("");
  expect(editor?.getAttribute("aria-label")).toBe("Ask a follow-up");
  expect(form?.getAttribute("style")).toContain(
    '--promptbox-container-compact-placeholder: ""',
  );
  expect(screen.getByText("GPT-5")).toBeTruthy();
});
