import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DownloadPage } from "./download-page";
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

describe("/download page", () => {
  it("lists the other computers, the command and the phone apps", () => {
    const html = renderToStaticMarkup(<DownloadPage />);
    const body = html.slice(
      html.indexOf('class="dl-body"'),
      html.indexOf('class="footer"'),
    );
    expect(html).toContain('href="/download/macos?placement=download_page"');
    expect(body).not.toContain("/download/macos");
    expect(body).toContain('href="/download/windows?placement=download_page"');
    expect(body).toContain('href="/download/linux?placement=download_page"');
    expect(body).toContain(CLI_COMMAND);
    expect(body).toContain("testflight.apple.com");
    expect(body).toContain("bb-android.apk");
  });
});
