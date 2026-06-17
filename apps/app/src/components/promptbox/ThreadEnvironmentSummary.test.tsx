import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

describe("ThreadEnvironmentSummary", () => {
  it("renders the compact environment string label with its icon", () => {
    const markup = renderToStaticMarkup(
      <ThreadEnvironmentSummary
        environmentLabel="Working locally"
        environmentCompactLabel="Local"
        environmentIcon="Laptop"
      />,
    );

    expect(markup).toContain('title="Environment: Working locally"');
    expect(markup).toContain('data-promptbox-full-label="">Local</span>');
    expect(markup).toContain('data-promptbox-compact-label="">Local</span>');
    expect(markup).not.toContain(">Working locally</span>");
    expect(markup).toContain('data-icon="Laptop"');
  });
});
