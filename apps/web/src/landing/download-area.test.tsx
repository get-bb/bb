import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExperimentsProvider } from "../experiments/context";
import { InstallOptions, SimpleInstallOptions } from "./landing-visuals";
import { CLI_COMMAND, GITHUB_URL } from "./site";

describe("homepage-download-area install block", () => {
  it("keeps the command in control", () => {
    const html = renderToStaticMarkup(<InstallOptions placement="hero" />);
    expect(html).toContain(CLI_COMMAND);
    expect(html).not.toContain("Other platforms");
  });

  it("shows one button, the repo and /download in the test arm", () => {
    const html = renderToStaticMarkup(
      <SimpleInstallOptions placement="closer" />,
    );
    expect(html).toContain('href="/download/macos?placement=closer"');
    expect(html.match(/href="\/download\/(macos|windows|linux)/g)).toHaveLength(
      1,
    );
    expect(html).not.toContain(CLI_COMMAND);
    expect(html).not.toContain("Alpha");
    expect(html).toContain('href="/download">Other platforms</a>');
    const desktopNote = html.slice(html.indexOf("install-note-desktop"));
    const touchNote = html.slice(html.indexOf("install-note-touch"));
    expect(desktopNote).toContain(`href="${GITHUB_URL}"`);
    expect(touchNote).toContain(`href="${GITHUB_URL}"`);
    expect(touchNote).toContain("bb runs on macOS, Windows, and Linux");
  });
});

describe("homepage-download-area outside the homepage", () => {
  it.each([
    ["control", false],
    ["test", true],
  ])("renders the %s install block wherever it is used", (variant, simple) => {
    const html = renderToStaticMarkup(
      <ExperimentsProvider
        value={{
          distinctID: null,
          featureFlags: { "homepage-download-area": variant },
          preview: false,
        }}
      >
        <InstallOptions placement="closer" />
      </ExperimentsProvider>,
    );
    expect(html.includes("Other platforms")).toBe(simple);
    expect(html.includes(CLI_COMMAND)).toBe(!simple);
  });
});
