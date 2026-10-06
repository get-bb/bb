import { describe, expect, it } from "vitest";
import { createLocalViewUrl, type LocalViewModel } from "../src/local-view.js";

interface DecodeLocalViewHtmlArgs {
  viewModel: LocalViewModel;
}

interface LocalViewTestCase {
  label: string;
  viewModel: LocalViewModel;
}

const LOCAL_VIEW_URL_PREFIX = "data:text/html;charset=utf-8,";

const localViewTestCases: LocalViewTestCase[] = [
  {
    label: "loading",
    viewModel: {
      kind: "loading",
      message: "Starting local services.",
      title: "Opening bb",
    },
  },
  {
    label: "error",
    viewModel: {
      actions: [],
      details: "The local service failed to start.",
      kind: "error",
      logText: "Failed to bind port",
      title: "Could not open bb",
    },
  },
];

function decodeLocalViewHtml(args: DecodeLocalViewHtmlArgs): string {
  const url = createLocalViewUrl({ viewModel: args.viewModel });

  expect(url.startsWith(LOCAL_VIEW_URL_PREFIX)).toBe(true);

  return decodeURIComponent(url.slice(LOCAL_VIEW_URL_PREFIX.length));
}

describe("local desktop views", () => {
  it.each(localViewTestCases)(
    "renders an invisible window drag region for the $label view",
    (testCase) => {
      const html = decodeLocalViewHtml({ viewModel: testCase.viewModel });

      expect(html).toContain(
        '<div class="titlebar-drag-region" data-testid="bb-local-view-window-drag-region" aria-hidden="true"></div>',
      );
      expect(html).toMatch(
        /\.titlebar-drag-region\s+\{[\s\S]*app-region: drag;[\s\S]*-webkit-app-region: drag;[\s\S]*background: transparent;[\s\S]*border: 0;[\s\S]*height: 28px;/u,
      );
      expect(html).toMatch(
        /button,\s+a,\s+input,\s+textarea,\s+select,\s+summary,\s+pre\s+\{[\s\S]*app-region: no-drag;[\s\S]*-webkit-app-region: no-drag;/u,
      );
    },
  );

  it("renders startup error logs without terminal control sequences", () => {
    const html = decodeLocalViewHtml({
      viewModel: {
        actions: [],
        details: "The local service failed to start.",
        kind: "error",
        logText:
          "\x1b[2K  \x1b[2m○\x1b[0m  Starting server\r\x1b[2K  \x1b[32m✓\x1b[0m  Server listening\nError: listen EADDRINUSE",
        title: "Could not open bb",
      },
    });

    expect(html).toContain("<pre>");
    expect(html).toContain("Starting server");
    expect(html).toContain("Server listening");
    expect(html).toContain("Error: listen EADDRINUSE");
    expect(html).not.toContain("\x1b[");
    expect(html).not.toContain("\r");
  });

  it("renders one button per startup action and none without actions", () => {
    const actionHtml = decodeLocalViewHtml({
      viewModel: {
        actions: [
          { id: "retry", label: "Try again" },
          { id: "choose-server", label: "Choose server…" },
        ],
        details: "bb Connect did not accept this app.",
        kind: "error",
        logText: "",
        title: "Could not open Studio desktop",
      },
    });
    const fatalHtml = decodeLocalViewHtml({
      viewModel: {
        actions: [],
        details: "The desktop process could not continue.",
        kind: "error",
        logText: "",
        title: "Could not open bb",
      },
    });

    expect(actionHtml).toContain(
      '<div class="actions"><button type="button" data-startup-action="retry">Try again</button><button type="button" data-startup-action="choose-server">Choose server…</button></div>',
    );
    expect(fatalHtml).not.toContain("<button");
  });
});
