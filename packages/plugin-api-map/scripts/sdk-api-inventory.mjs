import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_ROOT = resolve(PACKAGE_ROOT, "../plugin-sdk");
export const INVENTORY_PATH = join(PACKAGE_ROOT, "sdk-public-api.json");

export function hashDeclarationTokens(source) {
  // build:types has already parsed and normalized these declarations. Scanning
  // their tokens keeps the inventory insensitive to comments and formatting
  // without repeating a full TypeScript parse and print for every subpath.
  const hash = createHash("sha256");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    const text = scanner.getTokenText();
    hash.update(`${token}:${Buffer.byteLength(text)}:`);
    hash.update(text);
  }
  return hash.digest("hex");
}

function publicTypeEntries() {
  const manifest = JSON.parse(
    readFileSync(join(SDK_ROOT, "package.json"), "utf8"),
  );
  return Object.entries(manifest.exports)
    .filter(([subpath]) => !subpath.startsWith("./internal/"))
    .map(([subpath, target]) => {
      const types = typeof target === "string" ? target : target.types;
      if (typeof types !== "string") {
        throw new Error(`Public SDK export ${subpath} has no types target`);
      }
      const path = resolve(SDK_ROOT, types);
      if (!existsSync(path)) {
        throw new Error(
          `Missing built declaration for ${subpath}: ${relative(SDK_ROOT, path)}. Run the @get-bb/plugin-sdk build:types task first.`,
        );
      }
      return [subpath, { path, types: relative(SDK_ROOT, path) }];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

export function createSdkPublicApiInventory() {
  return {
    schemaVersion: 1,
    entries: Object.fromEntries(
      publicTypeEntries().map(([subpath, entry]) => {
        return [
          subpath,
          {
            types: entry.types,
            sha256: hashDeclarationTokens(readFileSync(entry.path, "utf8")),
          },
        ];
      }),
    ),
  };
}

export function readSdkPublicApiInventory() {
  return JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--write")) {
    throw new Error("Pass --write to update the Plugin Guide SDK inventory");
  }
  writeFileSync(
    INVENTORY_PATH,
    `${JSON.stringify(createSdkPublicApiInventory(), null, 2)}\n`,
  );
  console.log(`Updated ${relative(process.cwd(), INVENTORY_PATH)}`);
}
