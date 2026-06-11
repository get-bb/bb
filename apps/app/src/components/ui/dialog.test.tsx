// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DialogHeader } from "./dialog.js";

afterEach(() => {
  cleanup();
});

describe("DialogHeader", () => {
  it("keeps headers left aligned when dialogs render as drawers", () => {
    render(<DialogHeader data-testid="dialog-header" />);

    const header = screen.getByTestId("dialog-header");

    expect(header.className).toContain("text-left");
    expect(header.className).not.toContain("text-center");
  });
});
