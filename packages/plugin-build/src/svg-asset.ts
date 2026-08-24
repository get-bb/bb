import { SaxesParser, type SaxesTagNS } from "saxes";
import { PLUGIN_ICON_MAX_BYTES } from "@bb/domain";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

/**
 * The elements that carry script, by lower-cased local name in any
 * namespace, so an un-namespaced `<SCRIPT>` and a prefixed `<x:script>` are
 * caught like `<script>`: `script` and the SVG-Tiny `handler`/`listener`
 * event elements.
 */
const SCRIPT_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "handler",
  "listener",
]);

/**
 * Elements a declared icon may not contain, on top of
 * {@link SCRIPT_ELEMENTS}: `foreignObject` and `iframe` embed arbitrary
 * HTML, `image`, `video`, `audio` and `a` fetch or navigate, and `style` can
 * carry `url()` loads. A declared icon is a static monochrome shape painted
 * through a CSS mask (web) or a native SVG view (mobile), and it needs none
 * of these.
 */
const FORBIDDEN_ICON_ELEMENTS: ReadonlySet<string> = new Set([
  ...SCRIPT_ELEMENTS,
  "foreignobject",
  "iframe",
  "image",
  "video",
  "audio",
  "a",
  "style",
]);

/**
 * Whether an attribute value loads something by URL: a `url(...)`, or one of
 * the quoted-string image loaders `src(...)`, `image(...)` and
 * `image-set(...)`, in a style, paint (`fill`, `stroke`), `filter`, `mask`,
 * `clip-path`, `marker-*` or `cursor` value whose target is not a
 * same-document `#` reference. The opener is matched greedily through its
 * whitespace and optional quote, then the next character is inspected, so
 * `url( "#g" )` is still allowed while a lookahead inside the pattern could
 * be backtracked around. Every attribute value is refused outright when it
 * carries a CSS escape (see {@link declaredIconProblem}), so `u\72l(` cannot
 * slip past the literal opener in any attribute a browser tokenizes as CSS.
 */
function hasExternalUrlFunction(value: string): boolean {
  for (const match of value.matchAll(
    /(?:url|src|image-set|image)\(\s*["']?\s*/giu,
  )) {
    if (value[match.index + match[0].length] !== "#") {
      return true;
    }
  }
  return false;
}

/**
 * Whether a SMIL `attributeName` (on `animate`, `set`, `animateTransform`…)
 * targets something the declared-icon attribute rules forbid setting
 * directly: an event handler, or an `href` that would be re-pointed at load
 * time.
 */
function isForbiddenAnimatedAttribute(value: string): boolean {
  const target = value.trim().toLowerCase();
  return (
    target.startsWith("on") || target === "href" || target.endsWith(":href")
  );
}

/**
 * Whether an `href` value is a `javascript:` URL the way a browser reads it:
 * the URL parser strips leading and trailing C0 controls and spaces, drops
 * every ASCII tab and newline, and matches the scheme case-insensitively, so
 * `" JavaScript:"` and `"java&#10;script:"` both run.
 */
function isJavascriptUrl(value: string): boolean {
  return value
    .replace(/[\t\n\r]/gu, "")
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/gu, "")
    .toLowerCase()
    .startsWith("javascript:");
}

/**
 * The first script vector one element (with its attributes) carries, as the
 * tail of an error message, or null when it carries none: an element in
 * {@link SCRIPT_ELEMENTS}, an `on*` event handler attribute, or an
 * `href`/`xlink:href` whose scheme is `javascript:`. Nothing else: a logo is
 * usually a tool export, and Illustrator, Inkscape, Figma and Sketch write
 * legacy doctypes, `<metadata>` in their own namespaces,
 * `<switch><foreignObject requiredExtensions=…>` fallbacks, `data:` and
 * external image references, `<a>`-wrapped artwork and the odd Latin-1 byte,
 * none of which a browser turns into script.
 */
function scriptVectorProblem(tag: SaxesTagNS): string | null {
  if (SCRIPT_ELEMENTS.has(tag.local.toLowerCase())) {
    return `must not contain a <${tag.name}> element`;
  }
  for (const attribute of Object.values(tag.attributes)) {
    const name = attribute.local.toLowerCase();
    if (name.startsWith("on")) {
      return `must not contain a <${tag.name} ${attribute.name}> event handler attribute`;
    }
    if (name === "href" && isJavascriptUrl(attribute.value)) {
      return `must not contain a javascript: URL in <${tag.name} ${attribute.name}>`;
    }
  }
  return null;
}

/**
 * The first declared-icon rule one element (with its attributes) breaks, as
 * the tail of an error message, or null when it breaks none: any element
 * outside the SVG namespace, the elements in {@link FORBIDDEN_ICON_ELEMENTS},
 * any `on*` attribute, any `href` / `xlink:href` that is not a same-document
 * `#` reference, any attribute value carrying a CSS escape (a backslash) or
 * an external `url(...)` (or `src`/`image`/`image-set` loader), a SMIL
 * `attributeName` that targets an `on*` handler or an `href`, and
 * `xml:base`.
 */
function declaredIconProblem(tag: SaxesTagNS): string | null {
  if (tag.uri !== "" && tag.uri !== SVG_NAMESPACE) {
    return `contains a <${tag.name}> element outside the SVG namespace`;
  }
  if (FORBIDDEN_ICON_ELEMENTS.has(tag.local.toLowerCase())) {
    return `must not contain a <${tag.local}> element`;
  }
  for (const attribute of Object.values(tag.attributes)) {
    const name = attribute.local.toLowerCase();
    if (name.startsWith("on")) {
      return `must not contain a <${tag.local} ${attribute.name}> event handler attribute`;
    }
    if (name === "href" && !attribute.value.startsWith("#")) {
      return `must not reference ${JSON.stringify(attribute.value)} through <${tag.local} ${attribute.name}>; only same-document "#" references are allowed`;
    }
    if (attribute.value.includes("\\")) {
      // A CSS escape (`u\72l(`) spells a loader the literal scan below
      // would not see. Browsers run more than `style` through the CSS
      // tokenizer: every mapped presentation attribute (`fill`, `stroke`,
      // `filter`, `mask`, `clip-path`, `marker-*`, `cursor`) and the SMIL
      // value attributes (`to`, `from`, `values`, `by`) that animate one,
      // so the refusal covers every attribute. A monochrome icon never
      // needs a backslash anywhere.
      return `must not contain a CSS escape in <${tag.local} ${attribute.name}>`;
    }
    if (hasExternalUrlFunction(attribute.value)) {
      return `must not reference ${JSON.stringify(attribute.value)} through <${tag.local} ${attribute.name}>; only same-document "url(#…)" references are allowed`;
    }
    if (
      name === "attributename" &&
      isForbiddenAnimatedAttribute(attribute.value)
    ) {
      return `must not animate ${JSON.stringify(attribute.value)} through <${tag.local} ${attribute.name}>`;
    }
    if (name === "base" && attribute.uri === XML_NAMESPACE) {
      return `must not contain a <${tag.local} ${attribute.name}> attribute`;
    }
  }
  return null;
}

interface SvgRules {
  /**
   * Refuse what the compact-icon validator has always refused: bytes that
   * are not UTF-8, a doctype, a processing instruction, malformed XML and a
   * root other than `<svg>`. Off for a logo, which may open with a legacy
   * doctype or carry a Latin-1 byte and is only scanned for script vectors.
   */
  structure: boolean;
  /** The markup rule over each element, or null when the set has none. */
  elementProblem: ((tag: SaxesTagNS) => string | null) | null;
}

/**
 * `bb.branding.icon` and a marketplace catalog icon, at build and at load:
 * the document shape only. What keeps the served document inert is the
 * response (`nosniff` and a `default-src 'none'` CSP), not a markup rule.
 */
const COMPACT_ICON_RULES: SvgRules = { structure: true, elementProblem: null };

/**
 * An SVG `bb.branding.logo.light`/`.dark` or a path-shaped provider icon, at
 * `bb plugin build` only: the script vectors of {@link scriptVectorProblem}
 * and nothing else, so no tool export fails the build. Install and load
 * take the file as declared.
 */
const LOGO_RULES: SvgRules = {
  structure: false,
  elementProblem: scriptVectorProblem,
};

/** `bb.branding.experimental_icons`, at build and at load. */
const DECLARED_ICON_RULES: SvgRules = {
  structure: true,
  elementProblem: declaredIconProblem,
};

/**
 * One namespace-aware parse of the exact bytes. The parser never resolves
 * external entities; a rule set that checks the structure rejects
 * declarations that could define entities outright. Structural problems
 * (bad UTF-8, a doctype, a processing instruction, malformed XML, a
 * non-`<svg>` root) are reported before the first element the markup rule
 * refuses, in document order. Without the structure rules the bytes are
 * decoded leniently (a Latin-1 byte becomes U+FFFD; every name and scheme
 * the markup rule reads is ASCII) and malformed XML is parsed best-effort,
 * so a script vector behind a broken tag is still reported. `subject` opens
 * every message.
 *
 * Reject-only, never rewrite: the served bytes are hashed and the build and
 * the load must agree on them, so a sanitizer that stripped content would
 * make the two disagree about what the plugin ships.
 */
function assertValidPluginSvg(
  bytes: Uint8Array,
  subject: string,
  rules: SvgRules,
): void {
  let source: string;
  if (rules.structure) {
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${subject} must contain valid UTF-8 SVG bytes`);
    }
  } else {
    source = new TextDecoder("utf-8").decode(bytes);
  }

  const roots: Array<{ local: string; uri: string }> = [];
  let parseError: string | null = null;
  let hasDoctype = false;
  let hasProcessingInstruction = false;
  let problem: string | null = null;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (roots.length === 0) roots.push({ local: tag.local, uri: tag.uri });
    if (rules.elementProblem !== null) {
      problem ??= rules.elementProblem(tag);
    }
  });
  parser.on("doctype", () => {
    hasDoctype = true;
  });
  parser.on("processinginstruction", () => {
    hasProcessingInstruction = true;
  });
  parser.on("error", (error) => {
    parseError ??= error.message;
  });
  parser.write(source).close();

  if (rules.structure) {
    if (hasDoctype) {
      throw new Error(`${subject} must not contain a doctype declaration`);
    }
    if (hasProcessingInstruction) {
      throw new Error(`${subject} must not contain processing instructions`);
    }
    if (parseError !== null) {
      throw new Error(`${subject} is not valid SVG XML: ${parseError}`);
    }
    const root = roots[0];
    if (
      root === undefined ||
      root.local !== "svg" ||
      (root.uri !== "" && root.uri !== SVG_NAMESPACE)
    ) {
      throw new Error(`${subject} must have an <svg> root element`);
    }
  }
  if (problem !== null) {
    throw new Error(`${subject} ${problem}`);
  }
}

/**
 * Validate the exact bytes of a plugin-owned compact icon (a path-shaped
 * `bb.branding.icon`, or a marketplace catalog icon) before BB builds or
 * serves it: valid UTF-8, no doctype, no processing instruction, well-formed
 * XML, an `<svg>` root. The document shape only; the response headers keep
 * the served document from running anything.
 */
export function assertValidPluginCompactIconSvg(
  bytes: Uint8Array,
  label = "bb.branding.icon",
): void {
  assertValidPluginSvg(bytes, `manifest ${label}`, COMPACT_ICON_RULES);
}

/**
 * Check the exact bytes of an SVG logo (`bb.branding.logo.light`/`.dark`)
 * or a path-shaped provider icon for script vectors, at `bb plugin build`
 * only: a `script`, `handler` or `listener` element in any namespace, an
 * `on*` attribute, or an `href`/`xlink:href` whose scheme is `javascript:`.
 * Nothing else is refused — a legacy doctype, foreign-namespace metadata,
 * `foreignObject`, `<a>`, `data:` or external image references, CSS escapes
 * and Latin-1 bytes are all accepted, because they are what tool exports
 * look like and the response headers keep the served document inert.
 * Install and load never call this. `subject` opens every message: the
 * manifest field and file at build
 * (`manifest bb.branding.logo.light ("./logo.svg")`), or a provider
 * declaration (`provider "<id>" icon "./icons/x.svg"`).
 */
export function assertValidPluginLogoSvg(
  bytes: Uint8Array,
  subject: string,
): void {
  assertValidPluginSvg(bytes, subject, LOGO_RULES);
}

/**
 * Validate the exact bytes of a plugin-declared icon
 * (`bb.branding.experimental_icons`) before BB builds or serves it. Stricter
 * than {@link assertValidPluginCompactIconSvg}: on top of the document-shape
 * rules it rejects every rule of {@link declaredIconProblem} and files over
 * `PLUGIN_ICON_MAX_BYTES`.
 */
export function assertValidPluginIconSvg(
  bytes: Uint8Array,
  label: string,
): void {
  if (bytes.byteLength > PLUGIN_ICON_MAX_BYTES) {
    throw new Error(
      `manifest ${label} is ${bytes.byteLength} bytes; the limit is ${PLUGIN_ICON_MAX_BYTES}`,
    );
  }
  assertValidPluginSvg(bytes, `manifest ${label}`, DECLARED_ICON_RULES);
}
