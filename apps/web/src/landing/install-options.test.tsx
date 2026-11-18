import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InstallOptions } from "./landing-visuals";
import { CLI_COMMAND } from "./site";

const html = renderToStaticMarkup(<InstallOptions placement="closer" />);

describe("install block", () => {
  it("offers only the platform download and the CLI command", () => {
    expect(html.match(/href="\/download\/(macos|windows|linux)/g)).toEqual([
      'href="/download/macos',
    ]);
    expect(html).toContain(
      `aria-label="Copy browser install command: ${CLI_COMMAND}"`,
    );
  });

  it("keeps the platform note for phones only", () => {
    expect(html.match(/class="install-note[^"]*"/g)).toEqual([
      'class="install-note install-note-touch"',
    ]);
    expect(html).toContain(
      '<span class="install-note install-note-touch">bb runs on macOS, Windows, and Linux</span>',
    );
  });
});
