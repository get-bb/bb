import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
  "Usage: node scripts/monthly-email/hosted-map.mjs issues/<yyyy-mm> <url> [<url> ...]";

export function md5(buffer) {
  return createHash("md5").update(buffer).digest("hex");
}

async function fetchDigest(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return md5(Buffer.from(await response.arrayBuffer()));
}

export function localGraphics(folder) {
  const byDigest = new Map();
  for (const name of readdirSync(folder)) {
    if (name.endsWith(".png")) {
      byDigest.set(md5(readFileSync(join(folder, name))), name);
    }
  }
  return byDigest;
}

export async function checkHosted(folder) {
  const path = join(folder, "hosted.json");
  const current = new Map();
  const unreachable = new Map();
  if (!existsSync(path)) return { current, unreachable };
  const local = localGraphics(folder);
  for (const [name, url] of Object.entries(
    JSON.parse(readFileSync(path, "utf8")),
  )) {
    try {
      if (local.get(await fetchDigest(url)) === name) current.set(name, url);
    } catch (error) {
      console.log(`Couldn't check ${name}: ${error.message}`);
      unreachable.set(name, url);
    }
  }
  return { current, unreachable };
}

export async function currentHostedNames(folder) {
  return (await checkHosted(folder)).current;
}

async function main() {
  const [folder, ...urls] = process.argv.slice(2);
  if (!folder) throw new Error(USAGE);
  const local = localGraphics(folder);
  const { current, unreachable } = await checkHosted(folder);
  const hosted = new Map([...unreachable, ...current]);
  for (const url of urls) {
    const name = local.get(await fetchDigest(url));
    if (!name) {
      console.log(
        `Skipped ${url}: it matches no current graphic (an older upload).`,
      );
      continue;
    }
    hosted.set(name, url);
  }
  const path = join(folder, "hosted.json");
  const sorted = Object.fromEntries(
    [...hosted].sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
  const missing = [...local.values()].filter((name) => !hosted.has(name));
  console.log(
    `${path}: ${hosted.size} matched${missing.length ? `, missing ${missing.join(", ")}` : ""}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
