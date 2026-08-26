import { describe, expect, it } from "vitest";
import { CLAIMED_EXTENSIONS, languageForPath } from "./languages.js";

/**
 * The Monaco bundle is trimmed to `basic-languages` (see
 * `monaco-bundle/editor.js`), so a language this plugin maps to must still be
 * one Monaco registers. Reads the built bundle rather than importing Monaco:
 * the point is to check what actually ships, and importing `monaco-editor`
 * here would prove nothing about the artifact.
 */
async function bundledLanguageIds(): Promise<Set<string> | null> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const bundle = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "dist",
    "monaco",
    "editor.js",
  );
  let source: string;
  try {
    source = await readFile(bundle, "utf8");
  } catch {
    return null;
  }
  // Every basic-language registers itself with `id:"<language>"` in its
  // language declaration; the minified bundle keeps those string literals.
  return new Set(
    [...source.matchAll(/id:"([a-z0-9+#-]+)"/g)].map((match) => match[1]!),
  );
}

describe("claimed languages", () => {
  it("maps every claimed extension to a language id", () => {
    for (const extension of CLAIMED_EXTENSIONS) {
      expect(languageForPath(`file.${extension}`)).toBeTruthy();
    }
  });

  it("only maps to languages the shipped bundle registers", async () => {
    const bundled = await bundledLanguageIds();
    if (bundled === null) {
      // The bundle is a build artifact; a source checkout that has not run
      // `build:monaco` should not fail here.
      expect(CLAIMED_EXTENSIONS.length).toBeGreaterThan(0);
      return;
    }
    const missing = [
      ...new Set(
        CLAIMED_EXTENSIONS.map((extension) => languageForPath(`f.${extension}`)),
      ),
    ]
      // Monaco always has plaintext; it has no basic-language declaration.
      .filter((language) => language !== "plaintext" && !bundled.has(language));

    expect(missing).toEqual([]);
  });
});
