import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);

const ASSET_HASH = /(\/assets\/[^"'\s)]*?)-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)/gu;
const ROUTER_TIMESTAMP = /\bu:\d{10,}/gu;
const PRELOAD_MAP =
  /const __vite__mapDeps=\(i,m=__vite__mapDeps,d=\(m\.f\|\|\(m\.f=\[[^\]]*\]\)\)\)=>i\.map\(i=>d\[i\]\);?/gu;
const PRELOAD_MAP_CALL = /__vite__mapDeps\(\[[\d,]*\]\)/gu;

function landingPaths() {
  const pagesDir = new URL("../src/landing/pages/", import.meta.url);
  const slugs = readdirSync(pagesDir)
    .filter((name) => name.endsWith(".meta.ts"))
    .map((name) => {
      const slug = /slug:\s*"([^"]+)"/u.exec(
        readFileSync(new URL(name, pagesDir), "utf8"),
      )?.[1];
      if (!slug) throw new Error(`No slug in ${name}`);
      return `/${slug}`;
    })
    .toSorted();
  return ["/", ...slugs];
}

function normalize(text) {
  return text.replace(ASSET_HASH, "$1$2").replace(ROUTER_TIMESTAMP, "u:0");
}

function withoutPreloadMaps(text) {
  return text.replace(PRELOAD_MAP, "").replace(PRELOAD_MAP_CALL, "[]");
}

function sha(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function fetchText(origin, path) {
  const response = await fetch(new URL(path, origin));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.text();
}

function attributeValues(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

async function pageFingerprint(origin, path) {
  const html = await fetchText(origin, path);
  const stylesheets = attributeValues(
    html,
    /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gu,
  ).toSorted();
  const scripts = [
    ...new Set([
      ...attributeValues(
        html,
        /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/gu,
      ),
      ...attributeValues(html, /<script[^>]*src="([^"]+)"/gu),
    ]),
  ].toSorted();
  const css = {};
  for (const href of stylesheets) {
    css[normalize(href)] = sha(normalize(await fetchText(origin, href)));
  }
  let jsBytes = 0;
  for (const src of scripts) {
    jsBytes += Buffer.byteLength(
      withoutPreloadMaps(await fetchText(origin, src)),
    );
  }
  return {
    markup: sha(normalize(html)),
    css,
    js: { files: scripts.map(normalize), bytes: jsBytes },
  };
}

async function fingerprint(origin, outFile) {
  const pages = {};
  for (const path of landingPaths()) {
    pages[path] = await pageFingerprint(origin, path);
  }
  writeFileSync(outFile, `${JSON.stringify(pages, null, 2)}\n`);
}

function compare(baseFile, headFile) {
  const base = JSON.parse(readFileSync(baseFile, "utf8"));
  const head = JSON.parse(readFileSync(headFile, "utf8"));
  const problems = [];
  for (const path of new Set([...Object.keys(base), ...Object.keys(head)])) {
    const before = base[path];
    const after = head[path];
    if (!before || !after) {
      problems.push(`${path}: page ${before ? "disappeared" : "appeared"}`);
      continue;
    }
    if (before.markup !== after.markup)
      problems.push(`${path}: markup changed`);
    if (JSON.stringify(before.css) !== JSON.stringify(after.css)) {
      problems.push(`${path}: CSS changed`);
    }
    if (JSON.stringify(before.js.files) !== JSON.stringify(after.js.files)) {
      problems.push(`${path}: loaded JS files changed`);
    }
    if (before.js.bytes !== after.js.bytes) {
      problems.push(
        `${path}: loaded JS weight changed from ${before.js.bytes} to ${after.js.bytes} bytes`,
      );
    }
  }
  if (problems.length > 0) {
    console.error(
      `A docs change altered the home or landing pages:\n- ${problems.join("\n- ")}`,
    );
    process.exit(1);
  }
  console.log(
    `Home and landing pages unchanged (${Object.keys(head).length} pages).`,
  );
}

if (command === "capture" && args.length === 2) {
  await fingerprint(args[0], args[1]);
} else if (command === "compare" && args.length === 2) {
  compare(args[0], args[1]);
} else {
  console.error(
    "Usage: landing-fingerprint.mjs capture <origin> <out.json> | compare <base.json> <head.json>",
  );
  process.exit(2);
}
