import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuidePage } from "./guide-page";
import { GUIDES } from "./guides";

describe("guide page hero", () => {
  it("shows the download button on every device and no send link", () => {
    const guide = GUIDES[0];
    expect(guide).toBeDefined();
    const html = renderToStaticMarkup(<GuidePage guide={guide!} />);
    const start = html.indexOf('<header class="hero cmp-hero gd-hero">');
    const hero = html.slice(start, html.indexOf("</header>", start));
    expect(hero).toContain(
      'class="btn btn-ghost" href="/download/macos?placement=hero"',
    );
    expect(hero).not.toContain("install-send");
  });
});
