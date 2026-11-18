import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InstallOptions } from "./landing-visuals";
import { CLI_COMMAND, GITHUB_URL } from "./site";

const html = renderToStaticMarkup(<InstallOptions placement="closer" />);

describe("install block", () => {
  it("puts Other platforms under the download button and Open source under the CLI command", () => {
    expect(html.match(/href="\/download\/(macos|windows|linux)/g)).toEqual([
      'href="/download/macos',
    ]);
    const [download, command] = html
      .split('<span class="install-choice">')
      .slice(1);
    expect(download).toContain(
      '<span class="install-note"><a class="install-note-link" href="/download">Other platforms</a></span>',
    );
    expect(download).not.toContain("Open source");
    expect(command).toContain(
      `aria-label="Copy browser install command: ${CLI_COMMAND}"`,
    );
    expect(command).toMatch(
      new RegExp(
        `<span class="install-note"><a [^>]*href="${GITHUB_URL}"[^>]*>.*Open source</a></span>`,
      ),
    );
    expect(command).not.toContain("Other platforms");
  });
});
