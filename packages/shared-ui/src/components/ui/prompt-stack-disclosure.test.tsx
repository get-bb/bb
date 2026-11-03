// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnimatedBody } from "./prompt-stack-disclosure";

afterEach(cleanup);

describe("AnimatedBody", () => {
  it("realizes the body on the first expand and retains it after collapse", () => {
    const { rerender } = render(
      <AnimatedBody
        id="body"
        labelledBy="toggle"
        isExpanded={false}
        collapsedBorder="none"
      >
        <span>expensive body</span>
      </AnimatedBody>,
    );
    expect(screen.queryByText("expensive body")).toBeNull();

    rerender(
      <AnimatedBody
        id="body"
        labelledBy="toggle"
        isExpanded
        collapsedBorder="none"
      >
        <span>expensive body</span>
      </AnimatedBody>,
    );
    expect(screen.getByText("expensive body")).not.toBeNull();

    rerender(
      <AnimatedBody
        id="body"
        labelledBy="toggle"
        isExpanded={false}
        collapsedBorder="none"
      >
        <span>expensive body</span>
      </AnimatedBody>,
    );
    expect(screen.getByText("expensive body")).not.toBeNull();
    expect(
      screen.getByRole("region", { hidden: true }).getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      screen.getByRole("region", { hidden: true }).hasAttribute("inert"),
    ).toBe(true);
  });
});
