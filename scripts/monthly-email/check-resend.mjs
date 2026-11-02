import { readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { htmlSizeProblem, renderEmail } from "./render-email.mjs";

const USAGE =
  "Usage: node scripts/monthly-email/check-resend.mjs scripts/monthly-email/issues/<yyyy-mm>.send.html scripts/monthly-email/issues/<yyyy-mm>.resend.html [scripts/monthly-email/issues/<yyyy-mm>.json scripts/monthly-email/issues/<yyyy-mm>.resend-fields.json]";

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== "#") return ENTITIES[entity.toLowerCase()] ?? match;
    const code =
      entity[1].toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

export function visibleText(html) {
  const withoutHead = html
    .replace(/<(style|head)[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(
      /<div[^>]*data-skip-in-text="true"[^>]*>[\s\S]*?<\/div><\/div>/g,
      "",
    );
  return decodeEntities(withoutHead.replace(/<[^>]+>/g, " "))
    .replaceAll(" ", "")
    .replaceAll("͏", "")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstDifference(a, b) {
  let index = 0;
  while (index < a.length && a[index] === b[index]) index += 1;
  if (index === a.length && index === b.length) return null;
  const start = Math.max(0, index - 30);
  return {
    ours: a.slice(start, index + 50),
    theirs: b.slice(start, index + 50),
  };
}

function attributeValues(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

export function compareResend(ours, theirs, spec, fields, hosted) {
  const checks = [
    ["visible text", visibleText(ours) === visibleText(theirs)],
    [
      "link targets",
      JSON.stringify(attributeValues(ours, /href="([^"]+)"/g)) ===
        JSON.stringify(attributeValues(theirs, /href="([^"]+)"/g)),
    ],
    [
      "image sources",
      JSON.stringify(attributeValues(ours, /<img[^>]*src="([^"]+)"/g)) ===
        JSON.stringify(attributeValues(theirs, /<img[^>]*src="([^"]+)"/g)),
    ],
    ["unsubscribe placeholder", theirs.includes("RESEND_UNSUBSCRIBE_URL")],
    ["body centered at 592px", theirs.includes("max-width:592px;align:center")],
    ["under the size limit", !htmlSizeProblem(theirs)?.fatal],
  ];
  if (spec && fields) {
    checks.push(
      ["send HTML matches the spec", renderEmail(spec, { hosted }) === ours],
      ["From", fields.from === spec.from],
      ["Reply-To", fields.replyTo === spec.reply_to],
      ["Subject", fields.subject === spec.subject],
      ["Preview text", fields.preview === spec.preview],
      ["draft name", fields.name === `What's new in bb · ${spec.month}`],
    );
  }
  return checks;
}

function main() {
  const [oursPath, theirsPath, specPath, fieldsPath] = process.argv.slice(2);
  if (!oursPath || !theirsPath) throw new Error(USAGE);
  const read = (path) => readFileSync(path, "utf8");
  if (Boolean(specPath) !== Boolean(fieldsPath)) throw new Error(USAGE);
  const hostedPath = specPath
    ? join(
        dirname(specPath),
        basename(specPath, extname(specPath)),
        "hosted.json",
      )
    : null;
  const checks = compareResend(
    read(oursPath),
    read(theirsPath),
    specPath ? JSON.parse(read(specPath)) : undefined,
    fieldsPath ? JSON.parse(read(fieldsPath)) : undefined,
    hostedPath ? JSON.parse(read(hostedPath)) : undefined,
  );
  const sizeProblem = htmlSizeProblem(read(theirsPath));
  if (sizeProblem) console.warn(sizeProblem.message);
  for (const [name, ok] of checks)
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  const difference = firstDifference(
    visibleText(read(oursPath)),
    visibleText(read(theirsPath)),
  );
  if (difference) {
    console.log(`  ours:   …${difference.ours}…`);
    console.log(`  Resend: …${difference.theirs}…`);
  }
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
