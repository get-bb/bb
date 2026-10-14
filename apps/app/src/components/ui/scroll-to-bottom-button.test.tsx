import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_PAGE_HEADER_SURFACE_CLASS } from "@/components/layout/AppPageHeader";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";

function renderButton(visible: boolean) {
  const markup = renderToStaticMarkup(
    <ScrollToBottomButton visible={visible} active onClick={() => {}} />,
  );
  const button = markup.match(
    /<button class="([^"]*)" aria-label="Scroll to latest event"[^>]*>(.*?)<\/button>/,
  );
  return {
    classes: button?.[1]?.split(" ") ?? [],
    content: button?.[2] ?? "",
  };
}

describe("surfaces that stay over the timeline do not blur their backdrop", () => {
  it("renders the scroll-to-bottom button on an opaque fill without blur", () => {
    const { classes, content } = renderButton(true);
    expect(classes).not.toContain("backdrop-blur");
    expect(classes).toContain("bg-background");
    expect(classes).not.toContain("hover:bg-state-hover");
    expect(classes).toContain("hover:bg-accent");
    expect(classes).not.toContain("invisible");
    expect(content).toContain("animate-shine-icon");
  });

  it("stops the shimmer and hides the button while it is not shown", () => {
    const { classes, content } = renderButton(false);
    expect(classes).toContain("invisible");
    expect(content).toContain("<svg");
    expect(content).not.toContain("animate-shine-icon");
  });

  it("keeps the shared page-header surface free of blur", () => {
    expect(APP_PAGE_HEADER_SURFACE_CLASS).not.toContain("backdrop-blur");
  });

  it("keeps the shared overlay backdrops free of blur", () => {
    const sharedUiRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../packages/shared-ui",
    );
    for (const file of [
      "src/components/ui/dialog.tsx",
      "src/components/ui/drawer.tsx",
      "src/components/ui/responsive-overlay.tsx",
    ]) {
      const source = readFileSync(join(sharedUiRoot, file), "utf8");
      expect(source, file).not.toContain("backdrop-blur");
    }
  });
});
