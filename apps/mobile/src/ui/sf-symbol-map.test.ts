import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_MAP, isIconName } from "./icon-map";
import {
  SF_SYMBOL_MAP,
  SF_SYMBOL_WEIGHT,
  SF_SYMBOL_WEIGHTS,
  sfSymbolFor,
} from "./sf-symbol-map";

const MAX_SF_SYMBOLS_VERSION = "4.2";

function sfSymbolCatalog(): Map<string, string> {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("sf-symbols-typescript/package.json");
  const source = readFileSync(
    join(dirname(packageJson), "dist", "index.d.ts"),
    "utf8",
  );
  const catalog = new Map<string, string>();
  let version: string | null = null;
  for (const line of source.split("\n")) {
    const block = line.match(/^export type SFSymbols(\d+)_(\d+) =/);
    if (block) {
      version = `${block[1]}.${block[2]}`;
      continue;
    }
    const entry = line.match(/^\s*\|\s*'([^']+)'/);
    if (entry && version && !catalog.has(entry[1])) {
      catalog.set(entry[1], version);
    }
  }
  return catalog;
}

function versionTuple(version: string): [number, number] {
  const [major = "0", minor = "0"] = version.split(".");
  return [Number(major), Number(minor)];
}

function isAtMost(version: string, limit: string): boolean {
  const [major, minor] = versionTuple(version);
  const [limitMajor, limitMinor] = versionTuple(limit);
  return major < limitMajor || (major === limitMajor && minor <= limitMinor);
}

describe("SF_SYMBOL_MAP", () => {
  it("maps every icon name", () => {
    const unmapped = Object.keys(ICON_MAP).filter(
      (name) => !isIconName(name) || sfSymbolFor(name) === undefined,
    );
    expect(unmapped).toEqual([]);
    for (const key of Object.keys(SF_SYMBOL_MAP)) {
      expect(isIconName(key), key).toBe(true);
    }
  });

  it("uses bare symbol names that exist by the deployment target's SF Symbols release", () => {
    const catalog = sfSymbolCatalog();
    expect(catalog.size).toBeGreaterThan(4000);
    const problems: string[] = [];
    for (const [name, symbol] of Object.entries(SF_SYMBOL_MAP)) {
      if (!/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(symbol)) {
        problems.push(`${name}: "${symbol}" is not a bare symbol name`);
        continue;
      }
      const since = catalog.get(symbol);
      if (since === undefined) {
        problems.push(`${name}: "${symbol}" is not in the SF Symbols catalog`);
      } else if (!isAtMost(since, MAX_SF_SYMBOLS_VERSION)) {
        problems.push(
          `${name}: "${symbol}" needs SF Symbols ${since} (max ${MAX_SF_SYMBOLS_VERSION})`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("symbol weights are the numeric fontWeight strings expo-image parses", () => {
    expect(Object.values(SF_SYMBOL_WEIGHTS)).toEqual([
      "100",
      "200",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
      "900",
    ]);
    expect(SF_SYMBOL_WEIGHTS[SF_SYMBOL_WEIGHT]).toBe("500");
  });
});
