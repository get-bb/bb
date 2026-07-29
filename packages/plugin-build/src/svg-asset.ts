import { SaxesParser } from "saxes";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Validate the exact bytes of a plugin-owned compact icon before BB builds or
 * serves it. The XML parser is namespace-aware and never resolves external
 * entities; declarations that could define entities are rejected outright.
 */
export function assertValidPluginCompactIconSvg(
  bytes: Uint8Array,
  label = "bb.branding.icon",
): void {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`manifest ${label} must contain valid UTF-8 SVG bytes`);
  }

  const roots: Array<{ local: string; uri: string }> = [];
  let parseError: string | null = null;
  let hasDoctype = false;
  let hasProcessingInstruction = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (roots.length === 0) roots.push({ local: tag.local, uri: tag.uri });
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

  if (hasDoctype) {
    throw new Error(`manifest ${label} must not contain a doctype declaration`);
  }
  if (hasProcessingInstruction) {
    throw new Error(
      `manifest ${label} must not contain processing instructions`,
    );
  }
  if (parseError !== null) {
    throw new Error(`manifest ${label} is not valid SVG XML: ${parseError}`);
  }
  const root = roots[0];
  if (
    root === undefined ||
    root.local !== "svg" ||
    (root.uri !== "" && root.uri !== SVG_NAMESPACE)
  ) {
    throw new Error(`manifest ${label} must have an <svg> root element`);
  }
}
