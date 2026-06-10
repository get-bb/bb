// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { restoreMatchMedia, setupMatchMedia } from "@/test/helpers/match-media";
import { COMPACT_VIEWPORT_QUERY } from "./hooks/use-compact-viewport.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

function setupCompactViewport() {
  setupMatchMedia({
    matchesByQuery: new Map([[COMPACT_VIEWPORT_QUERY, true]]),
  });
}

afterEach(() => {
  cleanup();
  restoreMatchMedia();
});

describe("responsive overlays", () => {
  it("blurs a focused text editor before opening a desktop picker", () => {
    render(
      <>
        <div
          role="textbox"
          aria-label="Prompt"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
        >
          Draft prompt
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">Model</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent mobileTitle="Model">
            <DropdownMenuItem>GPT-5</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );

    const editor = screen.getByRole("textbox", { name: "Prompt" });
    editor.focus();
    expect(document.activeElement).toBe(editor);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Model" }));

    expect(document.activeElement).not.toBe(editor);
  });

  it("blurs a focused text editor before opening a compact picker", () => {
    setupCompactViewport();

    render(
      <>
        <div
          role="textbox"
          aria-label="Prompt"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
        >
          Draft prompt
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">Model</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent mobileTitle="Model">
            <DropdownMenuItem>GPT-5</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );

    const editor = screen.getByRole("textbox", { name: "Prompt" });
    editor.focus();
    expect(document.activeElement).toBe(editor);

    fireEvent.click(screen.getByRole("button", { name: "Model" }));

    expect(document.activeElement).not.toBe(editor);
    expect(screen.getByRole("menuitem", { name: "GPT-5" })).toBeTruthy();
  });
});
