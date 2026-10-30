import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentHostedNames } from "./hosted-map.mjs";
import { themeImages } from "./render-email.mjs";

const SCRIPT_LIMIT = 128000;
const USAGE = [
  "Usage:",
  "  node scripts/monthly-email/browser-scripts.mjs resend issues/<yyyy-mm>.json <out-dir> [--preview-base <url>]",
  "  node scripts/monthly-email/browser-scripts.mjs save-extract issues/<yyyy-mm> < extract-run.json",
  "  node scripts/monthly-email/browser-scripts.mjs designs <base-url> <out-dir-on-browser-host> <design-name> [...] > render.js",
  "  node scripts/monthly-email/browser-scripts.mjs slack-shot issues/<yyyy-mm>.resend.html <png-path-on-browser-host> > slack.js",
].join("\n");

const OPEN_MAIN = 'const p = await browser.getPage("main");';

const CREATE_BROADCAST = `${OPEN_MAIN}
p.goto("https://resend.com/broadcasts").catch(() => {});
await new Promise((r) => setTimeout(r, 5000));
const create = await p.evaluateHandle(() => [...document.querySelectorAll("a,button")].find((x) => x.textContent.trim() === "Create broadcast"));
await create.click();
for (let i = 0; i < 30 && !(await p.$("input[type=file][accept='.html']")); i++) await new Promise((r) => setTimeout(r, 500));`;

const TITLE_BUTTON =
  '[...document.querySelectorAll("button")].find((b) => b.getBoundingClientRect().top < 60 && b.getBoundingClientRect().left > 300 && b.getBoundingClientRect().left < 900 && b.textContent.trim().length > 0 && !["Broadcasts", "Draft"].includes(b.textContent.trim()))';

function uploadImages(names, previewBase, create) {
  const firstFile = JSON.stringify(
    `${previewBase.replace(/\/+$/, "")}/${names[0]}`,
  );
  return `const NAMES = ${JSON.stringify(names)};
const q = await browser.getPage("assets");
q.goto(${firstFile}).catch(() => {});
await new Promise((r) => setTimeout(r, 4000));
${create ? CREATE_BROADCAST : OPEN_MAIN}
await p.evaluate(() => { window.__bbUploads = []; });
for (const name of NAMES) {
  const b64 = await q.evaluate(async (n) => {
    const buf = new Uint8Array(await (await fetch("./" + n + "?nocache=" + Date.now(), { cache: "no-store" })).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return btoa(s);
  }, name);
  await p.evaluate((n, b) => { window.__bbUploads.push(new File([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], n, { type: "image/png" })); }, name, b64);
}
await p.evaluate(() => {
  const input = [...document.querySelectorAll("input[type=file]")].find((i) => i.accept.startsWith("image"));
  const transfer = new DataTransfer();
  for (const file of window.__bbUploads) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 9000));
return { draft: await p.evaluate(() => location.href), urls: await p.evaluate(() => [...document.querySelectorAll("img")].map((i) => i.src).filter((s) => s.includes("resend-attachments"))) };`;
}

function uploadHtml(html, create) {
  return `${create ? CREATE_BROADCAST : OPEN_MAIN}
await p.evaluate((html) => {
  const input = [...document.querySelectorAll("input[type=file]")].find((i) => i.accept === ".html");
  const transfer = new DataTransfer();
  transfer.items.add(new File([html], "email.html", { type: "text/html" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, ${JSON.stringify(html)});
await new Promise((r) => setTimeout(r, 6000));
return await p.evaluate(() => location.href);`;
}

const PAGE_STYLE = `${OPEN_MAIN}
p.reload().catch(() => {});
await new Promise((r) => setTimeout(r, 7000));
const align = await p.evaluate(() => {
  const heading = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim() === "Body" && e.getBoundingClientRect().left > 900 && e.getBoundingClientRect().left < innerWidth);
  let section = heading.parentElement;
  while (section && section.querySelectorAll("button").length < 3) section = section.parentElement;
  const box = [...section.querySelectorAll("button")][1].getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2];
});
await p.mouse.click(align[0], align[1]);
await new Promise((r) => setTimeout(r, 800));
const inputs = await p.evaluate(() => [...document.querySelectorAll("input")].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.left > 900 && r.left < innerWidth; }).map((i) => { const r = i.getBoundingClientRect(); let row = i; while (row && !/^(Padding|Width)\\b/.test(row.innerText || "")) row = row.parentElement; return [r.left + r.width / 2, r.top + r.height / 2, row ? row.innerText.split("\\n")[0] : ""]; }));
const set = async (point, value) => { await p.mouse.click(point[0], point[1], { clickCount: 3 }); await p.keyboard.type(value); await p.keyboard.press("Enter"); await new Promise((r) => setTimeout(r, 700)); };
const pagePadding = inputs.find((i) => i[2] === "Padding");
const width = inputs.find((i) => i[2] === "Width");
await set(pagePadding, "0");
await set(width, "592");
return { pagePadding, width };`;

function fields(spec) {
  return `${OPEN_MAIN}
const typeInto = async (selector, value, slow) => {
  await p.click(selector);
  await p.evaluate((s) => document.querySelector(s).select(), selector);
  await p.keyboard.press("Backspace");
  for (const ch of value) { await p.keyboard.type(ch); if (slow) await new Promise((r) => setTimeout(r, 40)); }
  await p.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 400));
};
await typeInto("input[name=from]", ${JSON.stringify(spec.from)}, false);
await typeInto("input[name=replyto]", ${JSON.stringify(spec.reply_to)}, true);
await typeInto("input[placeholder=Subject]", ${JSON.stringify(spec.subject)}, false);
await p.evaluate((value) => {
  const el = document.querySelector("input[name=preview]");
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}, ${JSON.stringify(spec.preview)});
await new Promise((r) => setTimeout(r, 400));
const title = await p.evaluateHandle(() => ${TITLE_BUTTON});
await title.click();
await new Promise((r) => setTimeout(r, 600));
await p.evaluate(() => document.activeElement.select && document.activeElement.select());
await p.keyboard.press("Backspace");
await p.keyboard.type(${JSON.stringify(`What's new in bb · ${spec.month}`)});
await p.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 1500));
return await p.evaluate(() => ({ from: document.querySelector("input[name=from]").value, replyTo: document.querySelector("input[name=replyto]").value, subject: document.querySelector("input[placeholder=Subject]").value, preview: document.querySelector("input[name=preview]").value }));`;
}

const EXTRACT = `${OPEN_MAIN}
p.reload().catch(() => {});
await new Promise((r) => setTimeout(r, 7000));
const head = await p.evaluate(() => ({ from: document.querySelector("input[name=from]").value, replyTo: document.querySelector("input[name=replyto]").value, subject: document.querySelector("input[placeholder=Subject]").value, preview: document.querySelector("input[name=preview]").value, name: ${TITLE_BUTTON}?.textContent.trim() }));
const code = await p.evaluateHandle(() => [...document.querySelectorAll("button,a")].find((b) => (b.getAttribute("aria-label") || "") === "Code" || b.textContent.trim() === "Code"));
await code.click();
await new Promise((r) => setTimeout(r, 2500));
return { ...head, html: await p.evaluate(() => document.querySelector("iframe[srcdoc]").srcdoc) };`;

function renderDesigns(baseUrl, outDir, names) {
  return `const NAMES = ${JSON.stringify(names)};
const p = await browser.getPage("render");
await p.setCacheEnabled(false);
await p.setViewport({ width: 700, height: 900, deviceScaleFactor: 3 });
const out = [];
for (const name of NAMES) {
  await p.goto(${JSON.stringify(`${baseUrl.replace(/\/+$/, "")}/`)} + name + ".html?r=" + Date.now(), { waitUntil: "networkidle0" });
  await p.evaluate(() => document.fonts.ready);
  const clip = await p.evaluate(() => { const b = document.querySelector(".c").getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
  await p.screenshot({ path: ${JSON.stringify(`${outDir.replace(/\/+$/, "")}/`)} + name + ".png", clip, captureBeyondViewport: false });
  out.push([name, clip.width, clip.height]);
}
return out;`;
}

function slackShot(html, pngPath) {
  return `const p = await browser.getPage("shot");
await p.setViewport({ width: 680, height: 1000, deviceScaleFactor: 2 });
await p.setContent(${JSON.stringify(html)}, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: ${JSON.stringify(pngPath)}, fullPage: true });
return await p.evaluate(() => document.documentElement.scrollHeight);`;
}

function checked(name, script) {
  if (script.length > SCRIPT_LIMIT) {
    throw new Error(
      `${name} is ${script.length} characters; the limit is ${SCRIPT_LIMIT}`,
    );
  }
  return script;
}

async function writeResendScripts(specPath, outDir, previewBase) {
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const issue = join(dirname(specPath), basename(specPath, extname(specPath)));
  const sendPath = `${issue}.send.html`;
  const scripts = {
    "3-page-style": PAGE_STYLE,
    "4-fields": fields(spec),
    "5-extract": EXTRACT,
  };
  if (existsSync(sendPath)) {
    const html = readFileSync(sendPath, "utf8");
    scripts["2-upload-html"] = uploadHtml(html, true);
    scripts["2b-upload-html-into-open-draft"] = uploadHtml(html, false);
  } else {
    console.log(
      `Skipped the upload-HTML scripts: render ${sendPath} once hosted.json is complete, then run this again.`,
    );
  }
  if (previewBase) {
    const names = [
      ...new Set(spec.themes.flatMap(themeImages).map((image) => image.src)),
    ].sort();
    const current = await currentHostedNames(issue);
    const changed = names.filter((name) => !current.has(name));
    scripts["1-upload-images"] = uploadImages(names, previewBase, true);
    if (changed.length) {
      scripts["1b-upload-changed-images-into-open-draft"] = uploadImages(
        changed,
        previewBase,
        false,
      );
    }
  }
  mkdirSync(outDir, { recursive: true });
  for (const [name, script] of Object.entries(scripts).sort()) {
    const path = join(outDir, `${name}.js`);
    writeFileSync(path, checked(name, script));
    console.log(path);
  }
}

function saveExtract(issue) {
  const run = JSON.parse(readFileSync(0, "utf8"));
  if (run.ok === false) throw new Error(`Extract failed: ${run.error.message}`);
  const data = typeof run.text === "string" ? JSON.parse(run.text) : run.text;
  const { html, ...headerFields } = data;
  const base = issue.replace(/\/+$/, "");
  writeFileSync(`${base}.resend.html`, html);
  writeFileSync(
    `${base}.resend-fields.json`,
    `${JSON.stringify(headerFields, null, 2)}\n`,
  );
  console.log(`${base}.resend.html`);
  console.log(`${base}.resend-fields.json`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "resend" && args.length >= 2) {
    const index = args.indexOf("--preview-base");
    await writeResendScripts(
      args[0],
      args[1],
      index >= 0 ? args[index + 1] : null,
    );
  } else if (command === "save-extract" && args.length === 1) {
    saveExtract(args[0]);
  } else if (command === "designs" && args.length >= 3) {
    process.stdout.write(
      checked("designs", renderDesigns(args[0], args[1], args.slice(2))),
    );
  } else if (command === "slack-shot" && args.length === 2) {
    process.stdout.write(
      checked("slack-shot", slackShot(readFileSync(args[0], "utf8"), args[1])),
    );
  } else {
    throw new Error(USAGE);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
