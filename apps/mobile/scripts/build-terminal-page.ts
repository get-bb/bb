/// <reference types="node" />
/**
 * Bundles the terminal WebView page (`src/screens/terminal/page/
 * terminal-page.ts` + xterm.js + the fit / unicode11 / web-links addons +
 * xterm.css + the page CSS) into one self-contained HTML document,
 * `assets/terminal/index.html`. The React Native side loads that asset and
 * hands the HTML string to `react-native-webview` (`source={{ html }}`), so
 * the terminal needs no network access of its own.
 *
 * The result is committed; `src/screens/terminal/terminal-page.test.ts`
 * rebuilds it in memory and fails when the asset is stale.
 *
 * Run: `pnpm --filter @bb/mobile terminal:build`
 * (`node --conditions=source --import tsx scripts/build-terminal-page.ts`).
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_DIR = join(MOBILE_ROOT, "src", "screens", "terminal", "page");
const PAGE_ENTRY = join(PAGE_DIR, "terminal-page.ts");
const PAGE_CSS = join(PAGE_DIR, "terminal-page.css");
export const TERMINAL_PAGE_OUTPUT_PATH = join(
  MOBILE_ROOT,
  "assets",
  "terminal",
  "index.html",
);

const require = createRequire(import.meta.url);

function readXtermCss(): string {
  return readFileSync(require.resolve("@xterm/xterm/css/xterm.css"), "utf8");
}

function readXtermVersion(): string {
  const pkg = JSON.parse(
    readFileSync(require.resolve("@xterm/xterm/package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

async function bundlePageScript(): Promise<string> {
  const result = await build({
    entryPoints: [PAGE_ENTRY],
    bundle: true,
    write: false,
    minify: true,
    format: "iife",
    platform: "browser",
    // WKWebView on iOS 16+ / Chrome WebView on Android 10+.
    target: ["safari16", "chrome100"],
    legalComments: "none",
    logLevel: "silent",
    absWorkingDir: MOBILE_ROOT,
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error("esbuild produced no output");
  // An inline script must not contain a literal closing script tag.
  return file.text.replace(/<\/script/giu, "<\\/script");
}

export function renderTerminalPageHtml(args: {
  script: string;
  xtermCss: string;
  pageCss: string;
  xtermVersion: string;
}): string {
  return [
    "<!doctype html>",
    `<!-- GENERATED FILE: run pnpm --filter @bb/mobile terminal:build (xterm ${args.xtermVersion}) -->`,
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    '<meta name="color-scheme" content="light dark">',
    "<style>",
    args.xtermCss.trim(),
    args.pageCss.trim(),
    "</style>",
    "</head>",
    "<body>",
    '<div id="terminal"></div>',
    '<div id="error"></div>',
    "<script>",
    args.script.trim(),
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Full pipeline: bundle the page script and inline everything. */
export async function buildTerminalPageHtml(): Promise<string> {
  const [script, xtermCss, pageCss] = await Promise.all([
    bundlePageScript(),
    readXtermCss(),
    readFileSync(PAGE_CSS, "utf8"),
  ]);
  return renderTerminalPageHtml({
    script,
    xtermCss,
    pageCss,
    xtermVersion: readXtermVersion(),
  });
}

async function main(): Promise<void> {
  const html = await buildTerminalPageHtml();
  mkdirSync(dirname(TERMINAL_PAGE_OUTPUT_PATH), { recursive: true });
  writeFileSync(TERMINAL_PAGE_OUTPUT_PATH, html);
  console.log(
    `wrote ${TERMINAL_PAGE_OUTPUT_PATH} (${(html.length / 1024).toFixed(0)} KiB)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
