import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExperimentsProvider } from "../experiments/context";
import { InstallOptions } from "./landing-visuals";
import { CLI_COMMAND, GITHUB_URL } from "./site";

function renderArm(variant: "control" | "test") {
  return renderToStaticMarkup(
    <ExperimentsProvider
      value={{
        distinctID: null,
        featureFlags: { "homepage-download-path": variant },
        preview: false,
      }}
    >
      <InstallOptions placement="closer" />
    </ExperimentsProvider>,
  );
}

describe("homepage-download-path install block", () => {
  it("keeps the command in control", () => {
    const html = renderArm("control");
    expect(html).toContain(CLI_COMMAND);
    expect(html).not.toContain("Other platforms");
  });

  it("shows one button, the repo and /download, with no note on macOS, in the test arm", () => {
    const html = renderArm("test");
    expect(html.match(/href="\/download\/(macos|windows|linux)/g)).toEqual([
      'href="/download/macos',
    ]);
    expect(html).not.toContain(CLI_COMMAND);
    expect(html).toMatch(
      /<span class="install-note install-note-desktop"><a [^>]*href="https:\/\/github.com\/get-bb\/bb"/,
    );
    expect(html).toContain(`href="${GITHUB_URL}"`);
    expect(html).toContain('href="/download">Other platforms</a>');
  });

  it("gives phones the computers' line without the chip note in the test arm", () => {
    const touch = renderArm("test").split(
      '<span class="install-note install-note-touch">',
    )[1];
    expect(touch).toMatch(
      /^<a [^>]*>.*Open source<\/a> · <a class="install-note-link" href="\/download">Other platforms<\/a><\/span>/,
    );
    expect(renderArm("test")).not.toContain("bb runs on macOS");
  });
});
