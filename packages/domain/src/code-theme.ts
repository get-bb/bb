import { z } from "zod";
import { draculaLightCodeTheme } from "./code-themes/dracula-light.js";
import { nordLightCodeTheme } from "./code-themes/nord-light.js";
import { jsonObjectSchema, type JsonObject } from "./json-value.js";

export const DEFAULT_CODE_THEME_DARK = "pierre-dark";
export const DEFAULT_CODE_THEME_LIGHT = "pierre-light";

/** Safe Shiki / Pierre / registered theme name. Paths are not allowed. */
export const codeThemeNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
    "Code theme names may use letters, digits, '.', '_', ':', and '-' and cannot start with '.'",
  );

export const codeThemePairSchema = z
  .object({
    dark: codeThemeNameSchema,
    light: codeThemeNameSchema,
  })
  .strict();
export type CodeThemePair = z.infer<typeof codeThemePairSchema>;

export const vscodeThemeJsonSchema = jsonObjectSchema.refine(
  (value) => typeof value.name === "string" && value.name.length > 0,
  { message: "Code theme JSON must include a non-empty name" },
);
export type VscodeThemeJson = JsonObject & { name: string };

export const resolvedCodeThemeSchema = z
  .object({
    dark: codeThemeNameSchema,
    light: codeThemeNameSchema,
    files: z.record(z.string(), jsonObjectSchema),
  })
  .strict();
export type ResolvedCodeTheme = z.infer<typeof resolvedCodeThemeSchema>;

export const defaultResolvedCodeTheme: ResolvedCodeTheme = {
  dark: DEFAULT_CODE_THEME_DARK,
  light: DEFAULT_CODE_THEME_LIGHT,
  files: {},
};

/** Optional declaration a UI theme ships for its matching code colors. */
export const uiCodeThemeDeclarationSchema = z
  .object({
    dark: z.string().min(1).max(256).optional(),
    light: z.string().min(1).max(256).optional(),
  })
  .strict();
export type UiCodeThemeDeclaration = z.infer<
  typeof uiCodeThemeDeclarationSchema
>;

/**
 * Code-theme pair that follows each built-in appearance palette. Custom and
 * plugin palettes use their declared Pierre / VS Code files when present.
 * Palettes Shiki only ships as dark (Nord, Dracula) use a first-party light
 * file under `bb:<id>:light`; the rest use the bundled light/dark names.
 */
export const builtInPaletteCodeThemes = {
  default: {
    dark: DEFAULT_CODE_THEME_DARK,
    light: DEFAULT_CODE_THEME_LIGHT,
  },
  nord: { dark: "nord", light: "bb:nord:light" },
  dracula: { dark: "dracula", light: "bb:dracula:light" },
  solarized: { dark: "solarized-dark", light: "solarized-light" },
  gruvbox: { dark: "gruvbox-dark-medium", light: "gruvbox-light-medium" },
  catppuccin: { dark: "catppuccin-mocha", light: "catppuccin-latte" },
} as const satisfies Record<string, CodeThemePair>;

export interface DeclaredCodeThemeSlot {
  name: string;
  file?: JsonObject;
}

export interface DeclaredCodeTheme {
  dark?: DeclaredCodeThemeSlot;
  light?: DeclaredCodeThemeSlot;
}

export const CUSTOM_CODE_THEME_JSON_MAX_LENGTH = 256_000;

/** True when a UI-theme declaration points at a JSON file rather than a bundled name. */
export function isCodeThemeFilePath(value: string): boolean {
  return value.includes("/") || value.toLowerCase().endsWith(".json");
}

export function formatRegisteredCodeThemeName(
  sourceId: string,
  side: "dark" | "light",
): string {
  return `bb:${sourceId}:${side}`;
}

const VSCODE_THEME_JSON_MAX_DEPTH = 32;

function jsonDepthExceeds(value: unknown, maxDepth: number): boolean {
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > maxDepth) return true;
    if (node === null || typeof node !== "object") return false;
    if (Array.isArray(node)) {
      return node.some((entry) => visit(entry, depth + 1));
    }
    return Object.values(node).some((entry) => visit(entry, depth + 1));
  };
  return visit(value, 0);
}

export function parseVscodeThemeJson(value: unknown): VscodeThemeJson | null {
  try {
    if (jsonDepthExceeds(value, VSCODE_THEME_JSON_MAX_DEPTH)) return null;
    const parsed = vscodeThemeJsonSchema.safeParse(value);
    if (!parsed.success) return null;
    return parsed.data as VscodeThemeJson;
  } catch {
    return null;
  }
}

export function paletteCodeThemeFallback(paletteId: string): CodeThemePair {
  if (Object.hasOwn(builtInPaletteCodeThemes, paletteId)) {
    return builtInPaletteCodeThemes[
      paletteId as keyof typeof builtInPaletteCodeThemes
    ];
  }
  return builtInPaletteCodeThemes.default;
}

const builtInPaletteCodeThemeFiles: Partial<
  Record<keyof typeof builtInPaletteCodeThemes, Record<string, JsonObject>>
> = {
  nord: { "bb:nord:light": nordLightCodeTheme },
  dracula: { "bb:dracula:light": draculaLightCodeTheme },
};

/**
 * Pierre's `resolveTheme` requires `theme.name` to equal the registered id.
 * Author files keep a display name ("Ocean Dark"); stamp the wire id before
 * `registerCustomTheme` so the highlighter does not fall back to pierre-light.
 */
export function stampRegisteredThemeName(
  name: string,
  file: JsonObject,
): JsonObject {
  if (file.name === name) return file;
  return { ...file, name };
}

export function resolveCodeTheme(
  declared: DeclaredCodeTheme | null,
  paletteId = "default",
): ResolvedCodeTheme {
  const fallback = paletteCodeThemeFallback(paletteId);
  const dark = declared?.dark?.name ?? fallback.dark;
  const light = declared?.light?.name ?? fallback.light;
  const files: Record<string, JsonObject> = {};
  const builtInFiles =
    paletteId in builtInPaletteCodeThemeFiles
      ? builtInPaletteCodeThemeFiles[
          paletteId as keyof typeof builtInPaletteCodeThemeFiles
        ]
      : undefined;
  if (builtInFiles !== undefined) {
    for (const [name, file] of Object.entries(builtInFiles)) {
      if (name === dark || name === light) {
        files[name] = stampRegisteredThemeName(name, file);
      }
    }
  }
  if (declared?.dark?.file !== undefined) {
    files[dark] = stampRegisteredThemeName(dark, declared.dark.file);
  }
  if (declared?.light?.file !== undefined) {
    files[light] = stampRegisteredThemeName(light, declared.light.file);
  }
  return { dark, light, files };
}
