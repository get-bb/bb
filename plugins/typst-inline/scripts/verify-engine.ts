import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { compileTypstDocument, compileTypstPdf } from "../lib/typst-engine";
import { buildTypstPrintHtml } from "../lib/typst-export";
import { splitTypstPages } from "../lib/typst-pages";

const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const encoder = new TextEncoder();
const png = new Uint8Array(
  await readFile(
    new URL("../../../apps/app/public/favicon-16x16.png", import.meta.url),
  ),
);

const files = new Map<string, Uint8Array>();
for (let index = 0; index < 20; index += 1) {
  files.set(`/reports/assets/img-${index}.png`, png);
}
files.set("/reports/chapters/assets/deep.png", png);
files.set(
  "/reports/chapters/intro.typ",
  encoder.encode("Intro with a nested image.\n"),
);

const mainSource = [
  '#include "chapters/intro.typ"',
  "",
  "= Report",
  "",
  "#for index in range(20) [",
  '  #image("assets/img-" + str(index) + ".png", width: 4pt)',
  "]",
  "",
  "$ integral_0^1 x^2 dif x = 1/3 $",
  "",
].join("\n");

async function probe(label: string, source: string): Promise<void> {
  const requested: string[] = [];
  try {
    const svg = await compileTypstDocument({
      mainPath: "/reports/main.typ",
      source,
      readDependency: async (path: string) => {
        requested.push(path);
        const content = files.get(path);
        if (content === undefined) {
          throw new Error(`Typst dependency not found: ${path}`);
        }
        return content;
      },
    });
    console.log(
      `[ok] ${label}: ${svg.length} bytes, ${requested.length} dependencies, script=${/<script/i.test(svg)}`,
    );
  } catch (error) {
    console.log(
      `[fail] ${label}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

await probe("report with includes and images", mainSource);
await probe("include only", '= T\n#include "chapters/intro.typ"\n');
await probe("static image", '= T\n#image("assets/img-0.png")\n');
await probe(
  "missing dependency",
  '= T\n#image("assets/does-not-exist.png")\n',
);
await probe("invalid source", "= Broken\n#nope()\n");

files.set(
  "/reports/chapters/intro.typ",
  encoder.encode("Second revision text.\n"),
);
await probe("updated dependency", '= T\n#include "chapters/intro.typ"\n');

const pagedSource = [
  "#set page(width: 200pt, height: 100pt, margin: 10pt)",
  "= Page one",
  "#pagebreak()",
  "= Page two",
].join("\n");
const pagedSvg = await compileTypstDocument({
  mainPath: "/reports/paged.typ",
  source: pagedSource,
  readDependency: async () => {
    throw new Error("no dependencies expected");
  },
});
const pages = splitTypstPages(pagedSvg);
console.log(
  "pages:",
  pages.length,
  pages.map((page) => `${page.widthPt}x${page.heightPt}`).join(","),
);
console.log(
  "page one is isolated:",
  pages[0]!.svg.includes("typst-page") &&
    pages[0]!.svg.includes("translate(0, 0)"),
);
const printHtml = buildTypstPrintHtml(pages, "paged.typ");
console.log(
  "print html: sheets=",
  printHtml.match(/<section class="typst-page">/g)?.length,
  "page size=",
  /@page \{ size: ([^;]+);/.exec(printHtml)?.[1],
);

const pdf = await compileTypstPdf({
  mainPath: "/reports/paged.typ",
  source: pagedSource,
  readDependency: async () => {
    throw new Error("no dependencies expected");
  },
});
console.log(
  "pdf bytes:",
  pdf.byteLength,
  "magic:",
  new TextDecoder().decode(pdf.slice(0, 5)),
);
