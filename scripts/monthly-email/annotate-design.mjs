import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "./render-email.mjs";

const USAGE =
  "Usage: node scripts/monthly-email/annotate-design.mjs <annotations.json> <out.html>";
const ANCHORS = {
  c: "translateX(-50%)",
  r: "translateX(calc(-100% + 10px))",
  l: "translateX(-10px)",
};

function round(value) {
  return Math.round(value * 10) / 10;
}

function label(text, x, y, anchor = "c") {
  return `<div class="lab" style="left:${x}px;top:${y}px;transform:${ANCHORS[anchor]}">${escapeHtml(text)}</div>`;
}

function line(x, y1, y2) {
  return `<div class="ln" style="left:${x}px;top:${round(Math.min(y1, y2))}px;height:${round(Math.abs(y2 - y1))}px"></div>`;
}

export function annotateDesign(config) {
  const [pageWidth, pageHeight] = config.page;
  const shotWidth = config.shot_width ?? 520;
  const left = config.left ?? 20;
  const top = config.top ?? 46;
  const scale = shotWidth / pageWidth;
  const x = (value) => round(left + value * scale);
  const y = (value) => round(top + value * scale);
  const elements = config.elements;
  const rings = Object.values(elements)
    .map(
      ([x1, y1, x2, y2, radius]) =>
        `<div class="ring" style="left:${x(x1)}px;top:${y(y1)}px;width:${round((x2 - x1) * scale)}px;height:${round((y2 - y1) * scale)}px;border-radius:${radius}px"></div>\n`,
    )
    .join("");
  let bottom = y(pageHeight);
  const parts = [];
  for (const entry of config.labels) {
    const [x1, y1, x2, y2] = elements[entry.element];
    const center = round((x(x1) + x(x2)) / 2 + (entry.dx ?? 0));
    let labelTop;
    let lineStart;
    let lineEnd;
    if (entry.side === "above" && entry.gap === undefined) {
      [labelTop, lineStart, lineEnd] = [14, 33, y(y1)];
    } else if (entry.side === "above") {
      [labelTop, lineStart, lineEnd] = [
        round(y(y1) - entry.gap - 19),
        round(y(y1) - entry.gap),
        y(y1),
      ];
    } else {
      const gap = entry.gap ?? 12;
      [labelTop, lineStart, lineEnd] = [
        round(y(y2) + gap),
        y(y2),
        round(y(y2) + gap),
      ];
    }
    bottom = Math.max(bottom, labelTop + 19);
    parts.push(
      label(entry.text, center, labelTop, entry.anchor),
      line(center, lineStart, lineEnd),
    );
  }
  const height = Math.round(bottom + 7);
  const shotHeight = round(pageHeight * scale);
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="design-base.css"><style>
.c{height:${height}px}
.shot{position:absolute;left:${left}px;top:${top}px;width:${shotWidth}px;height:${shotHeight}px;background:url(${JSON.stringify(config.capture)}) no-repeat;background-size:${shotWidth}px ${shotHeight}px;border-radius:10px;box-shadow:0 1px 2px rgba(20,40,70,.06),0 12px 30px rgba(20,40,70,.14);overflow:hidden}
.ring{position:absolute;border-radius:5px;box-shadow:0 0 0 1px color-mix(in oklch, oklch(0.55 0.1 250) 75%, transparent);}
.lab{position:absolute;font-size:9.5px;font-weight:500;color:oklch(0.48 0.1 250);background:rgba(255,255,255,.92);border:1px solid color-mix(in oklch, oklch(0.55 0.1 250) 30%, white);border-radius:999px;padding:2px 7px;white-space:nowrap;box-shadow:0 1px 2px rgba(20,40,70,.06)}
.ln{position:absolute;width:1px;background:color-mix(in oklch, oklch(0.55 0.1 250) 55%, transparent)}
</style></head><body><div class="c">
<div class="shot"></div>
${rings}${parts.join("")}
</div></body></html>`;
}

function main() {
  const [configPath, outPath] = process.argv.slice(2);
  if (!configPath || !outPath) throw new Error(USAGE);
  writeFileSync(
    outPath,
    annotateDesign(JSON.parse(readFileSync(configPath, "utf8"))),
  );
  console.log(outPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
