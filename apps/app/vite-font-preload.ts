import type { HtmlTagDescriptor, Plugin } from "vite";

/**
 * Basename (without the content hash) of the one font file worth preloading:
 * the Inter latin upright variable subset that renders nearly all UI text.
 * The other six @font-face subsets (latin-ext, cyrillic, greek, vietnamese,
 * italics) stay lazy: preloading them would cost bytes on every load for
 * glyphs most sessions never draw.
 */
const PRELOADED_FONT_BASENAME = "inter-latin-wght-normal";
const PRELOADED_FONT_FILE_RE = new RegExp(
  `(^|/)${PRELOADED_FONT_BASENAME}(-[\\w-]+)?\\.woff2$`,
);

/**
 * Picks the emitted asset for the preloaded font out of the output bundle and
 * returns the `<link rel="preload">` for it. Empty when the font is not in
 * the bundle (for example a build that dropped the @fontsource import), so a
 * stale preload can never point at a missing file.
 */
export function resolveFontPreloadTags(
  bundleFileNames: Iterable<string>,
  base: string,
): HtmlTagDescriptor[] {
  const fileName = [...bundleFileNames].find((name) =>
    PRELOADED_FONT_FILE_RE.test(name),
  );
  if (fileName === undefined) return [];
  return [
    {
      tag: "link",
      attrs: {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        // CSS fetches fonts in CORS mode, so the preload must be CORS too or
        // the browser fetches the file a second time for the @font-face.
        crossorigin: true,
        href: `${base}${fileName}`,
      },
      injectTo: "head",
    },
  ];
}

function serializeTag(tag: HtmlTagDescriptor): string {
  const attrs = Object.entries(tag.attrs ?? {})
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([name, value]) => (value === true ? name : `${name}="${value}"`))
    .join(" ");
  return `<${tag.tag} ${attrs}>`;
}

/**
 * Moves the render-blocking stylesheet and the font preload ahead of the
 * modulepreload block in the built document.
 *
 * Vite appends its asset tags in [entry script, modulepreload…, stylesheet]
 * order, which put the stylesheet 68th and the font preload last among the
 * document's resources. The tunnel relay serializes responses FIFO on one
 * WebSocket, so discovery order is delivery order: first paint waited for
 * ~1.5 MB of JavaScript to clear the wire before the CSS arrived.
 *
 * The pre-paint theme script (`bb.theme` in index.html) must keep running
 * before the stylesheet applies — otherwise every dark-mode cold load
 * flashes the light palette — so this refuses to move the stylesheet ahead
 * of it and fails the build rather than shipping the flash.
 */
export function reorderHeadForFirstPaint(
  html: string,
  fontPreloadTags: HtmlTagDescriptor[],
): string {
  const stylesheets: string[] = [];
  const withoutStylesheets = html.replace(
    /[ \t]*<link[^>]*rel="stylesheet"[^>]*>\n?/g,
    (tag) => {
      stylesheets.push(tag.trim());
      return "";
    },
  );

  const block = [
    ...fontPreloadTags.map(serializeTag),
    ...stylesheets.map((tag) =>
      tag.includes("fetchpriority")
        ? tag
        : tag.replace("<link ", '<link fetchpriority="high" '),
    ),
  ].join("");
  if (block === "") return html;

  const anchor = firstPreloadableTagIndex(withoutStylesheets);
  const themeScriptAt = withoutStylesheets.indexOf("bb.theme");
  if (themeScriptAt === -1 || anchor <= themeScriptAt) {
    throw new Error(
      "bb:font-preload: the pre-paint theme script must precede the injected asset tags in index.html; refusing to move the stylesheet ahead of it",
    );
  }
  return (
    withoutStylesheets.slice(0, anchor) +
    block +
    withoutStylesheets.slice(anchor)
  );
}

/** Where the browser's preload scanner meets the first script/preload tag. */
function firstPreloadableTagIndex(html: string): number {
  const candidates = [
    html.search(/<link rel="modulepreload"/),
    html.search(/<script type="module"[^>]*src=/),
    html.indexOf("</head>"),
  ].filter((index) => index >= 0);
  if (candidates.length === 0) {
    throw new Error("bb:font-preload: built index.html has no <head>");
  }
  return Math.min(...candidates);
}

/**
 * Build-only head surgery for first paint: preloads the Inter latin woff2 and
 * moves it plus the app stylesheet ahead of the modulepreload block (see
 * reorderHeadForFirstPaint). Without the preload the font request starts only
 * once the CSS has parsed and the first text node needs it, which on a phone
 * is after ~1.5 MB of JavaScript. The dev server has no hashed asset to point
 * at, and dev has no first-paint budget.
 */
export function fontPreload(): Plugin {
  let base = "/";
  return {
    name: "bb:font-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (ctx.bundle === undefined) return html;
        return reorderHeadForFirstPaint(
          html,
          resolveFontPreloadTags(Object.keys(ctx.bundle), base),
        );
      },
    },
  };
}
