import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InstallOptions } from "./landing-visuals";
import { CLI_COMMAND, GITHUB_URL } from "./site";

const html = renderToStaticMarkup(<InstallOptions placement="closer" />);

describe("install block", () => {
  it("offers the macOS download, the repo, /download and the CLI command", () => {
    expect(html.match(/href="\/download\/(macos|linux)/g)).toEqual([
      'href="/download/macos',
    ]);
    expect(html).toMatch(
      /<span class="install-note install-note-desktop"><a [^>]*href="https:\/\/github.com\/get-bb\/bb"/,
    );
    expect(html).toContain(`href="${GITHUB_URL}"`);
    expect(html).toContain('href="/download">Other platforms</a>');
    expect(html).toContain(
      `aria-label="Copy browser install command: ${CLI_COMMAND}"`,
    );
    expect(html).toMatch(
      /href="\/download\/windows[^"]*"[^>]*>Windows \(Alpha\)<\/a>, Intel Macs &amp; remote machines<\/span>/,
    );
  });

  it("gives phones the same links without the platform note", () => {
    const touch = html.split(
      '<span class="install-note install-note-touch">',
    )[1];
    expect(touch).toMatch(
      /^<a [^>]*>.*Open source<\/a> · <a class="install-note-link" href="\/download">Other platforms<\/a><\/span>/,
    );
    expect(html).not.toContain("bb runs on macOS");
  });
});
