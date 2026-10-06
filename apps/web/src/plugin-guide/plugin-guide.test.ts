import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SURFACE_GROUPS } from "../../../../plugins/plugin-api-docs/src/surfaces";
import { pluginPageHref } from "./plugin-directory";

const pluginsDir = new URL("../../../../plugins/", import.meta.url);
const guideSourceDir = new URL("plugin-api-docs/src/", pluginsDir);
const webTheme = readFileSync(
  new URL("../components/ui/theme.css", import.meta.url),
  "utf8",
);

const TAILWIND_COLORS = /^(?:black|white|transparent|current|inherit)$/u;
const NON_COLOR_SUFFIXES =
  /^(?:[trblxyse](?:-\d+)?|[xy]|\d.*|none|inset|offset-\d+|solid|dashed|dotted|left|center|right|justify|start|end|ellipsis|clip|wrap|nowrap|balance|pretty|xs|sm|base|lg|[2-9]?xl)$/u;
const TAILWIND_SHADOWS = /^(?:2xs|xs|sm|md|lg|xl|2xl|none|inner)$/u;
const TEXT_SIZE = /^(?:\d*xs|sm|base|lg|\d*xl)$/u;
const TAILWIND_TEXT_SIZES = /^(?:xs|sm|base|lg|[2-9]?xl)$/u;

function guideSource(): string {
  return readdirSync(guideSourceDir, { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/u.test(file))
    .map((file) => readFileSync(new URL(file, guideSourceDir), "utf8"))
    .join("\n");
}

function definedTokens(namespace: string): Set<string> {
  const pattern = new RegExp(`--${namespace}-([a-z0-9-]+):`, "gu");
  return new Set(Array.from(webTheme.matchAll(pattern), (match) => match[1] ?? ""));
}

function utilitySuffixes(source: string, prefixes: string): Set<string> {
  const pattern = new RegExp(
    `(?<![\\w-])(?:[a-z0-9@&_\\[\\]-]+:)*(?:${prefixes})-([a-z0-9][a-z0-9-]*)(?:/[\\d.]+)?(?![\\w-])`,
    "gu",
  );
  return new Set(Array.from(source.matchAll(pattern), (match) => match[1] ?? ""));
}

describe("Plugin Guide on the web", () => {
  it("defines every theme color, shadow and text size the Guide uses", () => {
    const source = guideSource();
    const colors = definedTokens("color");
    const shadows = definedTokens("shadow");
    const textSizes = definedTokens("text");

    const missingColors = [
      ...utilitySuffixes(
        source,
        "bg|text|border-[trblxyse]|border|ring|fill|stroke|outline|divide|from|via|to|decoration|placeholder|caret|accent",
      ),
    ].filter(
      (suffix) =>
        !colors.has(suffix) &&
        !TAILWIND_COLORS.test(suffix) &&
        !NON_COLOR_SUFFIXES.test(suffix),
    );
    const missingShadows = [...utilitySuffixes(source, "shadow")].filter(
      (suffix) => !shadows.has(suffix) && !TAILWIND_SHADOWS.test(suffix),
    );
    const missingTextSizes = [...utilitySuffixes(source, "text")].filter(
      (suffix) =>
        TEXT_SIZE.test(suffix) &&
        !textSizes.has(suffix) &&
        !TAILWIND_TEXT_SIZES.test(suffix),
    );

    expect({ missingColors, missingShadows, missingTextSizes }).toEqual({
      missingColors: [],
      missingShadows: [],
      missingTextSizes: [],
    });
  });

  it("links every Used by name to exactly one plugin", () => {
    const names = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => new URL(`${entry.name}/package.json`, pluginsDir))
      .filter((manifestUrl) => existsSync(manifestUrl))
      .flatMap((manifestUrl) => {
        const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
          bb?: { name?: string };
        };
        return manifest.bb?.name ? [manifest.bb.name] : [];
      });
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates).toEqual([]);

    const unlinked = SURFACE_GROUPS.flatMap((group) => group.surfaces)
      .flatMap((surface) => surface.firstParty ?? [])
      .filter((name) => pluginPageHref(name) === null);
    expect([...new Set(unlinked)]).toEqual([]);
  });
});
