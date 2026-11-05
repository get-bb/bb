import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InstallOptions } from "./landing-visuals";

describe("install options", () => {
  it("renders desktop and touch options for CSS to pick from", () => {
    const html = renderToStaticMarkup(<InstallOptions placement="hero" />);
    expect(html).toContain(
      'class="btn btn-primary btn-install desktop-only" href="/download/macos?placement=hero"',
    );
    expect(html).toContain(
      'class="btn btn-primary btn-install install-send touch-only"',
    );
    expect(html).toContain(
      '<span class="desktop-only"><a class="install-note-link" href="/download/windows?placement=hero">Windows (Alpha)</a>, </span>Intel Macs',
    );
  });
});
