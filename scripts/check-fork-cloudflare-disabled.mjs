import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

for (const workflow of [
  ".github/workflows/deploy-connect.yml",
  ".github/workflows/deploy-web.yml",
]) {
  requireCondition(!existsSync(path.join(root, workflow)), `${workflow} exists`);
}

for (const packagePath of [
  "apps/connect/package.json",
  "apps/web/package.json",
]) {
  const packageJson = JSON.parse(read(packagePath));
  requireCondition(
    packageJson.scripts?.deploy === undefined,
    `${packagePath} exposes a deploy script`,
  );
}

const deploymentSurface = [
  read("apps/connect/wrangler.jsonc"),
  read("apps/web/wrangler.jsonc"),
  read("scripts/bb-cloud-dev.mjs"),
  read("turbo.json"),
].join("\n");
const forbiddenProductionMarkers = [
  "7bb84c630057dafa53e2aacbe6bd094f",
  "5e37a076-93e9-4dcf-933f-761c22f7cf8b",
  "1aaa5562-457d-43a7-b11f-18b4f19bd62c",
  '"name": "bb-connect"',
  '"name": "bb-web"',
  "bb-connect-prod",
  "bb-connect-staging",
  "bb-web-staging",
  "*.getbb.app",
  "vibecodethis.site",
  "CLOUDFLARE_ENV",
  "wrangler deploy",
  "wrangler secret put",
  "--remote",
];
for (const marker of forbiddenProductionMarkers) {
  requireCondition(
    !deploymentSurface.includes(marker),
    `Cloudflare deployment surface contains ${JSON.stringify(marker)}`,
  );
}

const cloudDev = read("scripts/bb-cloud-dev.mjs");
requireCondition(cloudDev.includes('"--local"'), "cloud:dev is not local-only");

if (failures.length > 0) {
  console.error("Fork Cloudflare deployment must remain disabled:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Fork Cloudflare deployment is disabled; local Cloud QA remains enabled.");
