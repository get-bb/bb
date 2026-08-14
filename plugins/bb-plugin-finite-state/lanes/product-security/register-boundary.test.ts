import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const laneDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(laneDir, "../..");

function relativeImports(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:import|export)\s+(?:[^"']*?\sfrom\s*)?["']([^"']+)["']/gu,
    ),
  ]
    .map((match) => match[1])
    .filter((specifier): specifier is string =>
      Boolean(specifier?.startsWith(".")),
    );
}

function resolveSourceImport(importer: string, specifier: string): string {
  const importBase = resolve(
    dirname(importer),
    specifier.replace(/\.js$/u, ""),
  );
  const candidates = [
    `${importBase}.ts`,
    `${importBase}.tsx`,
    resolve(importBase, "index.ts"),
    resolve(importBase, "index.tsx"),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Could not resolve ${specifier} from ${importer}`);
  }
  return resolved;
}

function serverImportGraph(entry: string): string[] {
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const source = readFileSync(current, "utf8");
    for (const specifier of relativeImports(source)) {
      const imported = resolveSourceImport(current, specifier);
      if (imported.startsWith(pluginDir)) pending.push(imported);
    }
  }
  return [...visited];
}

describe("Product Security path-install import boundary", () => {
  it("loads the server registration entry in the Node test runtime", async () => {
    const module = await import("./register.js");
    expect(typeof module.registerProductSecurity).toBe("function");
  });

  it("keeps every server registration seam out of browser TSX", () => {
    const entry = resolve(laneDir, "register.ts");
    const source = readFileSync(entry, "utf8");
    for (const backend of [
      "./canvas/nodes/backend.js",
      "./canvas/scope/backend.js",
      "./canvas/threat-overlay/backend.js",
      "./canvas/links/backend.js",
      "./canvas/editing/backend.js",
      "./requirements/cards/backend.js",
      "./requirements/traceability/backend.js",
      "./requirements/conversion/backend.js",
      "./verifications/matrix/backend.js",
      "./verifications/run-detail/backend.js",
    ]) {
      expect(source).toContain(backend);
    }

    const graph = serverImportGraph(entry);
    expect(graph.some((path) => extname(path) === ".tsx")).toBe(false);
  });

  it("leaves browser components on the app-only registration path", () => {
    const browserRegistration = readFileSync(
      resolve(laneDir, "register.app.tsx"),
      "utf8",
    );
    expect(browserRegistration).toContain("./canvas/nodes/index.js");
    expect(browserRegistration).toContain("./requirements/cards/index.js");
    expect(browserRegistration).not.toContain("/backend.js");
  });
});
