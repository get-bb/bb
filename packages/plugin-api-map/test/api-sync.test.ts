import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SURFACE_GROUPS } from "../src/index";
import {
  createSdkPublicApiInventory,
  hashDeclarationTokens,
  readSdkPublicApiInventory,
} from "../scripts/sdk-api-inventory.mjs";

const SDK_SRC = join(import.meta.dirname, "../../plugin-sdk/src");

function read(...parts: string[]): string {
  return readFileSync(join(SDK_SRC, ...parts), "utf8");
}

const APP_CONTRACT = read("app-contract.ts");
const CONTRACT_SOURCES = [
  APP_CONTRACT,
  read("app.ts"),
  read("index.ts"),
  read("backend-contract.ts"),
  read("testing", "index.ts"),
  read("testing", "app.tsx"),
  read("testing", "fake-plugin-host.ts"),
  read("testing", "fake-sdk.ts"),
  read("testing", "host.ts"),
].join("\n");

const EXPORTED = new Set(
  [
    ...CONTRACT_SOURCES.matchAll(
      /^export (?:declare )?(?:abstract )?(?:interface|type|class|function|const|enum) ([A-Za-z_][A-Za-z0-9_]*)/gm,
    ),
  ].map((match) => match[1]),
);

const SURFACES = SURFACE_GROUPS.flatMap((group) => group.surfaces);

describe("public SDK inventory", () => {
  it("ignores declaration trivia but preserves every API token", () => {
    const compact =
      "export interface PluginApi { run(input: string): Promise<void>; }";
    const formatted = `
      /** Public plugin API. */
      export interface PluginApi {
        // Run the plugin.
        run(input: string): Promise<void>;
      }
    `;

    expect(hashDeclarationTokens(formatted)).toBe(
      hashDeclarationTokens(compact),
    );
    expect(hashDeclarationTokens(compact.replace("string", "number"))).not.toBe(
      hashDeclarationTokens(compact),
    );
  });

  it("matches every non-internal published declaration subpath", () => {
    expect(createSdkPublicApiInventory()).toEqual(readSdkPublicApiInventory());
  });
});

describe("surface-to-SDK links", () => {
  it("names only symbols the SDK still exports", () => {
    const missing: string[] = [];
    for (const surface of SURFACES) {
      expect(surface.apiSymbols.length, surface.id).toBeGreaterThan(0);
      for (const symbol of surface.apiSymbols) {
        if (!EXPORTED.has(symbol)) {
          missing.push(`${surface.id}: "${symbol}"`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

function registrationTypes(interfaceName: string): Map<string, string> {
  const body = APP_CONTRACT.match(
    new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  if (!body) throw new Error(`${interfaceName} not found in app-contract.ts`);
  const found = new Map<string, string>();
  for (const match of body.matchAll(
    /^ {2}([A-Za-z_][A-Za-z0-9_]*)\(\s*(?:registration:\s*)?([A-Za-z_][A-Za-z0-9_]*)/gm,
  )) {
    found.set(match[1], match[2]);
  }
  return found;
}

describe("registration slot coverage", () => {
  it("documents every slot the SDK ships", () => {
    const slots = [
      ...registrationTypes("PluginAppSlots"),
      ...registrationTypes("PluginAppComposer"),
      ...registrationTypes("PluginAppContentScripts"),
    ];
    expect(slots.length).toBeGreaterThanOrEqual(15);

    const documented = new Set(SURFACES.flatMap((s) => s.apiSymbols));
    const uncovered = slots
      .filter(([, type]) => !documented.has(type))
      .map(([method, type]) => `app.${method}() takes ${type}`);
    expect(uncovered).toEqual([]);
  });
});
