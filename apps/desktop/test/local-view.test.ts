import { describe, expect, it } from "vitest";
import {
  createLocalViewUrl,
  type LocalViewModel,
} from "../src/local-view.js";

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
});
