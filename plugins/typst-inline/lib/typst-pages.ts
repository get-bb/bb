const PAGE_CLASS = "typst-page";

const PAGE_START_TAG = `<g class="${PAGE_CLASS}"`;

const ROOT_SIZE_ATTRIBUTES = new Set(["height", "viewBox", "width"]);

const ROOT_SIZE_PATTERN = /\s+(?:width|height|viewBox)="[^"]*"/gu;

const PAGE_TRANSFORM_PATTERN = /transform="translate\([^)]*\)"/u;

const PAGE_WIDTH_PATTERN = /data-page-width="([^"]*)"/u;

const PAGE_HEIGHT_PATTERN = /data-page-height="([^"]*)"/u;

export interface TypstPage {
  heightPt: number;
  svg: string;
  widthPt: number;
}

function isPageGroup(node: Element): boolean {
  return (
    node.localName === "g" &&
    (node.getAttribute("class") ?? "").split(/\s+/).includes(PAGE_CLASS)
  );
}

function readDimension(group: Element, name: string): number {
  const value = Number.parseFloat(group.getAttribute(name) ?? "");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function readAttributeNumber(tag: string, pattern: RegExp): number {
  const value = Number.parseFloat(pattern.exec(tag)?.[1] ?? "");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isTagBoundary(character: string | undefined): boolean {
  return (
    character === undefined ||
    character === ">" ||
    character === "/" ||
    /\s/u.test(character)
  );
}

function findTagEnd(svg: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < svg.length; index += 1) {
    const character = svg[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index + 1;
  }
  return -1;
}

function findPageEnd(svg: string, start: number): number {
  let depth = 1;
  let index = start;
  while (index < svg.length) {
    const tagStart = svg.indexOf("<", index);
    if (tagStart < 0) return -1;
    if (svg.startsWith("</g", tagStart) && isTagBoundary(svg[tagStart + 3])) {
      depth -= 1;
      const end = findTagEnd(svg, tagStart);
      if (end < 0) return -1;
      if (depth === 0) return end;
      index = end;
      continue;
    }
    if (svg.startsWith("<g", tagStart) && isTagBoundary(svg[tagStart + 2])) {
      const end = findTagEnd(svg, tagStart);
      if (end < 0) return -1;
      if (!svg.slice(tagStart, end).trimEnd().endsWith("/>")) depth += 1;
      index = end;
      continue;
    }
    if (svg.startsWith("<!--", tagStart)) {
      const commentEnd = svg.indexOf("-->", tagStart);
      if (commentEnd < 0) return -1;
      index = commentEnd + 3;
      continue;
    }
    const end = findTagEnd(svg, tagStart);
    if (end < 0) return -1;
    index = end;
  }
  return -1;
}

function buildPageSvg(input: {
  heightPt: number;
  markup: string;
  preamble: string;
  rootAttributes: string;
  widthPt: number;
}): TypstPage {
  const { heightPt, markup, preamble, rootAttributes, widthPt } = input;
  return {
    heightPt,
    svg: `<svg${rootAttributes} viewBox="0 0 ${widthPt} ${heightPt}" width="${widthPt}pt" height="${heightPt}pt">${preamble}${markup}</svg>`,
    widthPt,
  };
}

function scanTypstPages(documentSvg: string): TypstPage[] | null {
  if (!documentSvg.startsWith("<svg")) return null;
  const rootEnd = findTagEnd(documentSvg, 0);
  if (rootEnd < 0) return null;
  const firstPage = documentSvg.indexOf(PAGE_START_TAG, rootEnd);
  if (firstPage < 0) return null;
  const rootAttributes = documentSvg
    .slice(4, rootEnd - 1)
    .replace(ROOT_SIZE_PATTERN, "");
  const preamble = documentSvg.slice(rootEnd, firstPage);
  const pages: TypstPage[] = [];
  let cursor = firstPage;
  while (cursor >= 0) {
    const openEnd = findTagEnd(documentSvg, cursor);
    if (openEnd < 0) return null;
    const openTag = documentSvg.slice(cursor, openEnd);
    const widthPt = readAttributeNumber(openTag, PAGE_WIDTH_PATTERN);
    const heightPt = readAttributeNumber(openTag, PAGE_HEIGHT_PATTERN);
    if (widthPt === 0 || heightPt === 0) return null;
    const pageEnd = findPageEnd(documentSvg, openEnd);
    if (pageEnd < 0) return null;
    const markup =
      openTag.replace(PAGE_TRANSFORM_PATTERN, 'transform="translate(0, 0)"') +
      documentSvg.slice(openEnd, pageEnd);
    pages.push(
      buildPageSvg({ heightPt, markup, preamble, rootAttributes, widthPt }),
    );
    const nextPage = documentSvg.indexOf(PAGE_START_TAG, pageEnd);
    if (nextPage < 0) {
      if (documentSvg.slice(pageEnd).trim() !== "</svg>") return null;
      break;
    }
    if (documentSvg.slice(pageEnd, nextPage).trim() !== "") return null;
    cursor = nextPage;
  }
  return pages;
}

function splitTypstPagesWithDom(documentSvg: string): TypstPage[] {
  const document = new DOMParser().parseFromString(
    documentSvg,
    "image/svg+xml",
  );
  const root = document.documentElement;
  if (root === null || root.localName !== "svg") {
    throw new Error("The Typst renderer did not return an SVG document.");
  }
  const serializer = new XMLSerializer();
  const pageGroups: Element[] = [];
  const sharedMarkup: string[] = [];
  for (const child of [...root.children]) {
    if (isPageGroup(child)) {
      pageGroups.push(child);
      continue;
    }
    sharedMarkup.push(serializer.serializeToString(child));
  }
  if (pageGroups.length === 0) {
    throw new Error("The Typst renderer did not return any page.");
  }
  const rootAttributes = [...root.attributes]
    .filter((attribute) => !ROOT_SIZE_ATTRIBUTES.has(attribute.name))
    .map(
      (attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`,
    )
    .join("");
  const preamble = sharedMarkup.join("");
  return pageGroups.map((group) => {
    const widthPt = readDimension(group, "data-page-width");
    const heightPt = readDimension(group, "data-page-height");
    group.setAttribute("transform", "translate(0, 0)");
    return buildPageSvg({
      heightPt,
      markup: serializer.serializeToString(group),
      preamble,
      rootAttributes,
      widthPt,
    });
  });
}

export function splitTypstPages(documentSvg: string): TypstPage[] {
  const scanned = scanTypstPages(documentSvg);
  if (scanned !== null) return scanned;
  return splitTypstPagesWithDom(documentSvg);
}
