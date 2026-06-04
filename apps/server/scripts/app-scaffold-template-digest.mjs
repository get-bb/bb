import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");

export const appScaffoldTemplatePath = path.resolve(
  serverRoot,
  "src",
  "services",
  "threads",
  "app-scaffold-template",
);
export const appScaffoldTemplateSourcePath = path.join(
  appScaffoldTemplatePath,
  "source",
);
export const appScaffoldTemplateDigestPath = path.resolve(
  serverRoot,
  "test",
  "public",
  "app-scaffold-template.digest.json",
);

// Local dev workflows (pnpm install, the template dev server, browser test
// runs) leave regenerable output behind inside source/; none of it feeds the
// vite build.
const EXCLUDED_SOURCE_ENTRY_NAMES = new Set([
  "node_modules",
  "screenshots",
  "playwright-report",
  "test-results",
]);

function collectFileHashes({ rootPath, excludedEntryNames }) {
  const hashes = {};
  const stack = [""];
  while (stack.length > 0) {
    const relativeDir = stack.pop();
    const absoluteDir = path.join(rootPath, relativeDir);
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (excludedEntryNames?.has(entry.name)) {
        continue;
      }
      const relativePath = path.posix.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      hashes[relativePath] = createHash("sha256")
        .update(readFileSync(path.join(rootPath, relativePath)))
        .digest("hex");
    }
  }
  return Object.fromEntries(
    Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * Hashes the app scaffold template's editable source/ tree (the vite build
 * inputs, including the generated bb-sdk.d.ts) and the committed prebuilt
 * public/ tree it produces. The recorded digest pins both sides so neither
 * can change without rerunning the rebuild script.
 */
export function computeAppScaffoldTemplateDigest() {
  return {
    public: collectFileHashes({
      rootPath: path.join(appScaffoldTemplatePath, "public"),
    }),
    source: collectFileHashes({
      rootPath: appScaffoldTemplateSourcePath,
      excludedEntryNames: EXCLUDED_SOURCE_ENTRY_NAMES,
    }),
  };
}
