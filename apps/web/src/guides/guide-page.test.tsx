import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuideHero } from "./guide-page";
import { GUIDES } from "./guides";

describe("guide hero", () => {
  it("offers the Mac download on desktop and the send link on touch", () => {
    const guide = GUIDES[0];
    expect(guide).toBeDefined();
    const html = renderToStaticMarkup(<GuideHero guide={guide!} />);
    expect(html).toContain(
      'class="btn btn-ghost desktop-only" href="/download/macos?placement=hero"',
    );
    expect(html).toContain('class="btn btn-ghost install-send touch-only"');
    expect(html).toContain("Send download link");
  });
});
