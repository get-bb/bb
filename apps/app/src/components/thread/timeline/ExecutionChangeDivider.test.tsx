// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeExecutionChange,
  ExecutionChangeDivider,
} from "./ExecutionChangeDivider";

afterEach(cleanup);

describe("describeExecutionChange", () => {
  it.each([
    [
      "a model change",
      {
        from: { model: "claude-opus-5-5", reasoningLevel: "high" },
        to: { model: "claude-sonnet-5-5", reasoningLevel: "high" },
      },
      "Opus 5.5 → Sonnet 5.5",
    ],
    [
      "a reasoning change",
      {
        from: { model: "claude-opus-5-5", reasoningLevel: "high" },
        to: { model: "claude-opus-5-5", reasoningLevel: "xhigh" },
      },
      "High → Extra High",
    ],
    [
      "both",
      {
        from: { model: "claude-opus-5-5", reasoningLevel: "low" },
        to: { model: "claude-haiku-5-5", reasoningLevel: "medium" },
      },
      "Opus 5.5 Low → Haiku 5.5 Medium",
    ],
    [
      "a non-Claude model",
      {
        from: { model: "gpt-5.6-sol", reasoningLevel: "medium" },
        to: { model: "gpt-5.6-terra", reasoningLevel: "medium" },
      },
      "GPT-5.6-Sol → GPT-5.6-Terra",
    ],
  ] as const)("names only what changed for %s", (_, change, expected) => {
    expect(describeExecutionChange(change)).toBe(expected);
  });
});

describe("ExecutionChangeDivider", () => {
  it("renders a separator with the change", () => {
    render(
      <ExecutionChangeDivider
        change={{
          from: { model: "gpt-5.6-sol", reasoningLevel: "medium" },
          to: { model: "gpt-5.6-terra", reasoningLevel: "medium" },
        }}
      />,
    );
    expect(
      screen.getByRole("separator", { name: /Settings changed/ }).textContent,
    ).toContain("→");
  });
});
