import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InstallOptions } from "./landing-visuals";
import { CLI_COMMAND } from "./site";

const html = renderToStaticMarkup(<InstallOptions placement="closer" />);

describe("install block", () => {
  it("offers only the macOS download and the CLI command, with no line under them", () => {
    expect(html.match(/href="\/download\/(macos|windows|linux)/g)).toEqual([
      'href="/download/macos',
    ]);
    expect(html).toContain(
      `aria-label="Copy browser install command: ${CLI_COMMAND}"`,
    );
    expect(html).not.toContain("install-note");
    expect(html).not.toContain("Other platforms");
  });
});
