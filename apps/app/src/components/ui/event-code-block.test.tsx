// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventCodeBlock } from "./event-code-block";

describe("EventCodeBlock", () => {
  it("opts event output into native text selection", () => {
    render(<EventCodeBlock>Selectable event output</EventCodeBlock>);

    expect(screen.getByText("Selectable event output").classList).toContain(
      "select-text",
    );
  });
});
