import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown-lite";

describe("Markdown", () => {
  it("renders GFM tables in pull request descriptions", () => {
    const markup = renderToStaticMarkup(
      <Markdown
        content={`## Changes
| Action | Pinned SHA | Version |
| --- | --- | --- |
| \`actions/checkout\` | \`11d5960a…\` | v4.4.0 |
| \`actions/setup-node\` | \`49933ea5…\` | v4.4.0 |`}
      />,
    );

    expect(markup).toContain("<table");
    expect(markup).toContain("<thead");
    expect(markup).toContain("<tbody");
    expect(markup).toContain("<th");
    expect(markup).toContain("<td");
    expect(markup).toContain("<code");
    expect(markup).not.toContain("| --- | --- | --- |");
  });

  it("supports aligned columns and escaped pipes inside cells", () => {
    const markup = renderToStaticMarkup(
      <Markdown
        content={`Name | Notes | Total
:--- | :---: | ---:
checkout | uses \\| safely | 2

After the table.`}
      />,
    );

    expect(markup.match(/<th(?:\s|>)/g)).toHaveLength(3);
    expect(markup.match(/<td(?:\s|>)/g)).toHaveLength(3);
    expect(markup).toContain("text-center");
    expect(markup).toContain("text-right");
    expect(markup).toContain("uses | safely");
    expect(markup).toContain("<p");
    expect(markup).toContain("After the table.");
  });
});
