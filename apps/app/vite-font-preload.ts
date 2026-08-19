import type { HtmlTagDescriptor, Plugin } from "vite";

/**
 * Basename (without the content hash) of the one font file worth preloading:
 * the Inter latin upright variable subset that renders nearly all UI text.
 * The other six @font-face subsets (latin-ext, cyrillic, greek, vietnamese,
 * italics) stay lazy: preloading them would cost bytes on every load for
 * glyphs most sessions never draw.
 */
export const PRELOADED_FONT_BASENAME = "inter-latin-wght-normal";
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

/**
 * Preloads the Inter latin woff2 from index.html. Without it the font request
 * starts only once the CSS has parsed and the first text node needs it, which
 * on a phone is after ~1.5 MB of JavaScript. Build-only: the dev server has no
 * hashed asset to point at, and dev has no first-paint budget.
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
      handler(_html, ctx) {
        if (ctx.bundle === undefined) return [];
        return resolveFontPreloadTags(Object.keys(ctx.bundle), base);
      },
    },
  };
}
