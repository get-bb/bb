import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThreadEnvironmentGoneBanner } from "./ThreadEnvironmentGoneBanner";

describe("ThreadEnvironmentGoneBanner", () => {
  it("renders a read-only 'environment is gone' notice with no provision action", () => {
    const markup = renderToStaticMarkup(<ThreadEnvironmentGoneBanner />);

    expect(markup).toContain("This environment is no longer available.");
    expect(markup).toContain('role="status"');
    // Read-only: there is intentionally no "Provision environment" action.
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Provision");
  });
});
