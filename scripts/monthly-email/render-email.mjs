import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentHostedNames } from "./hosted-map.mjs";

const FONT =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#333333";
const HEAD = "#1f1f1f";
const DIM = "#8a8a8a";
const RULE = "#e8e8e8";
const LINK = "#3e70a8";
export const MAX_HTML_BYTES = 80_000;
export const WARN_HTML_BYTES = 60_000;
export const MAX_SUBJECT_CHARS = 70;
export const MAX_PREVIEW_CHARS = 90;
export const LOGO = "bb-logo.png";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const USAGE =
  "Usage: node scripts/monthly-email/render-email.mjs issues/<yyyy-mm>.json [--images-base <url> | --hosted issues/<yyyy-mm>/hosted.json] [--out <file>]";

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function utm(ym, slot) {
  return `utm_source=bb&utm_medium=email&utm_campaign=monthly_releases_${ym}&utm_content=${slot}`;
}

function changelog(ym, slot, anchor = "") {
  return escapeHtml(
    `https://getbb.app/changelog?${utm(ym, slot)}${anchor ? `#${anchor}` : ""}`,
  );
}

function download(ym) {
  return escapeHtml(`https://getbb.app/?${utm(ym, "download")}`);
}

function styleBody(text) {
  return text
    .replaceAll(
      '<a href="',
      `<a style="color:${LINK};text-decoration:underline;" href="`,
    )
    .replace(
      /<code>(.*?)<\/code>/g,
      '<code style="font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:#f1f1f1;border-radius:4px;padding:1px 4px;">$1</code>',
    );
}

function versionLinks(item, ym, slug) {
  const links = item.versions
    .split(",")
    .map((version) => version.trim())
    .map(
      (version) =>
        `<a href="${changelog(ym, slug, version.replaceAll(".", "-"))}" style="color:${LINK};font-size:13px;text-decoration:underline;">${escapeHtml(version)}</a>`,
    )
    .join(", ");
  return `<span style="color:${DIM};font-size:13px;">(${links})</span>`;
}

export function themeImages(theme) {
  if (theme.images) return theme.images;
  return theme.image ? [theme.image] : [];
}

export function issueImages(spec) {
  return [
    LOGO,
    ...new Set(spec.themes.flatMap(themeImages).map((image) => image.src)),
  ];
}

export function issueIdentityProblems(spec, name) {
  const match = /^(\d{4})-(\d{2})/.exec(name);
  if (!match)
    return [`The spec file name ${name} must start with <yyyy>-<mm>.`];
  const [, year, month] = match;
  const problems = [];
  if (spec.ym !== `${year}_${month}`) {
    problems.push(`ym is ${spec.ym} but the file is for ${year}-${month}.`);
  }
  const expected = `${MONTHS[Number(month) - 1]} ${year}`;
  if (spec.month !== expected) {
    problems.push(`month is ${spec.month} but the file is for ${expected}.`);
  }
  return problems;
}

function themeRows(theme, ym, imagesBase, hosted) {
  const slug = theme.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const images = themeImages(theme);
  const rows = images.map(
    (image, index) =>
      `<tr><td style="padding:${index === 0 ? 40 : 12}px 0 0 0;"><img src="${escapeHtml(hosted?.[image.src] ?? imagesBase + image.src)}" width="560" alt="${escapeHtml(image.alt)}" style="display:block;width:100%;max-width:560px;height:auto;border-radius:12px;"></td></tr>`,
  );
  rows.push(
    `<tr><td style="padding:${images.length ? 22 : 40}px 0 0 0;"><h2 style="margin:0;font-size:22px;line-height:29px;letter-spacing:-0.01em;color:${HEAD};font-weight:700;">${escapeHtml(theme.title)}</h2></td></tr>`,
  );
  for (const item of theme.items) {
    rows.push(
      `<tr><td style="padding:12px 0 0 0;font-size:16px;line-height:25px;color:${INK};"><strong style="color:${HEAD};">${escapeHtml(item.title)}</strong> ${styleBody(item.body)} ${versionLinks(item, ym, slug)}</td></tr>`,
    );
  }
  if (theme.try) {
    rows.push(`<tr><td align="center" style="padding:20px 0 0 0;"><table role="presentation" width="440" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;">
<tr><td style="padding:0 0 6px 2px;font-size:10.5px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#71717a;">${escapeHtml(theme.try.label)}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:11px 12px 11px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:15px;line-height:22px;color:#27272a;">${escapeHtml(theme.try.prompt)}</td>
<td width="38" align="right" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="26" height="26" align="center" style="width:26px;height:26px;background:#3f3f46;border-radius:7px;color:#ffffff;font-size:14px;line-height:26px;">&#8593;</td></tr></table></td>
</tr></table></td></tr></table></td></tr>`);
  }
  return rows.join("\n");
}

export function renderEmail(spec, { imagesBase = "", hosted } = {}) {
  const { ym, cta } = spec;
  const logo = hosted?.[LOGO] ?? imagesBase + LOGO;
  const themes = spec.themes
    .map((theme) => themeRows(theme, ym, imagesBase, hosted))
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;font-family:${FONT};color:${INK};">
<tr><td style="padding:0 0 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="${escapeHtml(logo)}" width="28" height="28" alt="bb" style="display:block;"></td>
<td align="right" style="font-size:13px;color:${DIM};">${escapeHtml(spec.month)}</td></tr></table></td></tr>
<tr><td><h1 style="margin:0;font-size:34px;line-height:40px;letter-spacing:-0.02em;color:${HEAD};font-weight:700;">What's new in bb</h1>
<p style="margin:12px 0 0 0;font-size:17px;line-height:27px;color:${INK};">${escapeHtml(spec.opening)}</p></td></tr>
${themes}
<tr><td align="center" style="padding:44px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#333333;border-radius:8px;">
<a href="${changelog(ym, "cta")}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(cta.text)}</a></td></tr></table>
<p style="margin:12px 0 0 0;font-size:14px;color:#555555;">${escapeHtml(cta.download_prefix)} <a href="${download(ym)}" style="color:#555555;">${escapeHtml(cta.download_text)}</a></p></td></tr>
<tr><td style="padding:44px 0 0 0;"><div style="border-top:1px solid ${RULE};padding-top:24px;font-size:13px;line-height:20px;color:${DIM};text-align:center;">
You're getting this because you signed up for bb or Terragon updates.<br><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${DIM};">Unsubscribe</a> · ${escapeHtml(spec.address)}</div></td></tr>
</table></td></tr></table></body></html>`;
}

export function inboxLineProblems(spec) {
  const problems = [];
  const subject = [...spec.subject].length;
  const preview = [...spec.preview].length;
  if (subject > MAX_SUBJECT_CHARS) {
    problems.push(
      `The subject is ${subject} characters. Most email clients show ${MAX_SUBJECT_CHARS} or fewer, so shorten it.`,
    );
  }
  if (preview > MAX_PREVIEW_CHARS) {
    problems.push(
      `The preview line is ${preview} characters. Most mobile email clients show 40 to ${MAX_PREVIEW_CHARS}, so shorten it.`,
    );
  }
  return problems;
}

export function htmlSizeProblem(html) {
  const bytes = Buffer.byteLength(html);
  const size = `${Math.round(bytes / 1000)} KB`;
  if (bytes > MAX_HTML_BYTES) {
    return {
      fatal: true,
      message: `The HTML is ${size}, over the ${MAX_HTML_BYTES / 1000} KB limit. Gmail clips emails near 102 KB and hides the rest, including the unsubscribe link. Cut items or themes.`,
    };
  }
  if (bytes > WARN_HTML_BYTES) {
    return {
      fatal: false,
      message: `The HTML is ${size}. Gmail clips emails near 102 KB, and Resend's tracking links add to the size, so keep it under ${MAX_HTML_BYTES / 1000} KB.`,
    };
  }
  return null;
}

function parseArgs(argv) {
  const args = { spec: null, imagesBase: null, hosted: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--images-base") args.imagesBase = argv[++index];
    else if (arg === "--hosted") args.hosted = argv[++index];
    else if (arg === "--out") args.out = argv[++index];
    else if (!args.spec) args.spec = arg;
    else throw new Error(USAGE);
  }
  if (!args.spec) throw new Error(USAGE);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = JSON.parse(readFileSync(args.spec, "utf8"));
  const name = basename(args.spec, extname(args.spec));
  const specProblems = [
    ...issueIdentityProblems(spec, name),
    ...inboxLineProblems(spec),
  ];
  if (specProblems.length) throw new Error(specProblems.join("\n"));
  const imagesBase = (args.imagesBase ?? name).replace(/\/*$/, "/");
  const hosted = args.hosted
    ? JSON.parse(readFileSync(args.hosted, "utf8"))
    : undefined;
  if (hosted) {
    const missing = issueImages(spec).filter((src) => !hosted[src]);
    if (missing.length) {
      throw new Error(`No hosted URL for: ${missing.join(", ")}`);
    }
    const current = await currentHostedNames(dirname(args.hosted));
    const stale = issueImages(spec).filter((src) => !current.has(src));
    if (stale.length) {
      throw new Error(
        `The hosted copy of ${stale.join(", ")} doesn't match the local file. Upload it again (1b-upload-changed-images-into-open-draft.js) and run hosted-map.mjs first.`,
      );
    }
  }
  const html = renderEmail(spec, { imagesBase, hosted });
  const sizeProblem = htmlSizeProblem(html);
  if (sizeProblem?.fatal) throw new Error(sizeProblem.message);
  if (sizeProblem) console.warn(sizeProblem.message);
  const out = args.out ?? join(dirname(args.spec), `${name}.html`);
  writeFileSync(out, html);
  console.log(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
