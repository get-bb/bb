const PAGE_CLASS = "typst-page";

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

export function splitTypstPages(documentSvg: string): TypstPage[] {
  const document = new DOMParser().parseFromString(
    documentSvg,
    "image/svg+xml",
  );
  const root = document.documentElement;
  if (root === null || root.localName !== "svg") {
    throw new Error("The Typst renderer did not return an SVG document.");
  }
  const pageGroups = [...root.children].filter(isPageGroup);
  if (pageGroups.length === 0) {
    throw new Error("The Typst renderer did not return any page.");
  }

  return pageGroups.map((group, index) => {
    const widthPt = readDimension(group, "data-page-width");
    const heightPt = readDimension(group, "data-page-height");
    const clone = root.cloneNode(true) as Element;
    const clonedPages = [...clone.children].filter(isPageGroup);
    const page = clonedPages[index];
    if (page === undefined) {
      throw new Error("The Typst page could not be extracted.");
    }
    for (const other of clonedPages) {
      if (other !== page) other.remove();
    }
    page.setAttribute("transform", "translate(0, 0)");
    clone.setAttribute("viewBox", `0 0 ${widthPt} ${heightPt}`);
    clone.setAttribute("width", `${widthPt}pt`);
    clone.setAttribute("height", `${heightPt}pt`);
    return {
      heightPt,
      widthPt,
      svg: new XMLSerializer().serializeToString(clone),
    };
  });
}
