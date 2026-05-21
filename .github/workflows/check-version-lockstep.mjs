import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function readPackageVersion(packagePath) {
  const packageJson = JSON.parse(
    readFileSync(resolve(repoRoot, packagePath), "utf8"),
  );

  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    Array.isArray(packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error(`Missing string version field in ${packagePath}.`);
  }

  return packageJson.version;
}

const bbAppVersion = readPackageVersion("packages/bb-app/package.json");
const desktopVersion = readPackageVersion("apps/desktop/package.json");

if (bbAppVersion !== desktopVersion) {
  console.error(
    `Version mismatch: bb-app=${bbAppVersion} @bb/desktop=${desktopVersion}; bump both via scripts/bump-version.mjs`,
  );
  process.exit(1);
}

console.log(
  `Versions locked: bb-app=${bbAppVersion} @bb/desktop=${desktopVersion}`,
);
