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
      /<span class="install-note desktop-only"><a [^>]*href="https:\/\/github.com\/get-bb\/bb"/,
    );
    expect(html).toContain(`href="${GITHUB_URL}"`);
    expect(html).toContain('href="/download">Other platforms</a>');
  });

  it("gives phones the computers' line without the chip note in the test arm", () => {
    const touch = renderArm("test").split(
      '<span class="install-note touch-only">',
    )[1];
    expect(touch).toMatch(
      /^<a [^>]*>.*Open source<\/a> · <a class="install-note-link" href="\/download">Other platforms<\/a><\/span>/,
    );
    expect(renderArm("test")).not.toContain("bb runs on macOS");
  });
});

describe("homepage-download-area with the homepage-phone-email test", () => {
  function heroHtml(touchAction: "share" | "email") {
    return renderToStaticMarkup(
      <ExperimentsProvider
        value={{
          distinctID: null,
          featureFlags: {
            "homepage-download-area": "test",
            "homepage-phone-email": touchAction === "email" ? "test" : "control",
          },
          preview: false,
        }}
      >
        <InstallOptions placement="hero" touchAction={touchAction} />
      </ExperimentsProvider>,
    );
  }

  it("gives a phone in both test arms the email form", () => {
    const html = heroHtml("email");
    expect(html).toContain("Other platforms");
    expect(html.split('<span class="install-note touch-only">')[1]).toMatch(
      /^We’ll email a link to open on your computer<br\/>macOS, Windows, Linux<\/span>/,
    );
    expect(html).toContain('class="subscribe-form install-email touch-only"');
    expect(html).not.toContain("install-send");
  });

  it("leaves the desktop markup unchanged", () => {
    const desktopOnly = (html: string) =>
      html.match(/<[^>]*desktop-only[^>]*>.*?<\/(a|span)>/g);
    const email = desktopOnly(heroHtml("email"));
    expect(email).not.toBeNull();
    expect(email).toEqual(desktopOnly(heroHtml("share")));
    expect(email!.join("")).toContain(
      'class="btn btn-primary btn-install desktop-only" href="/download/macos?placement=hero"',
    );
  });
});
