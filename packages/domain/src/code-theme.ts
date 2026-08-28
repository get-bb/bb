import { z } from "zod";
import { draculaLightCodeTheme } from "./code-themes/dracula-light.js";
import { nordLightCodeTheme } from "./code-themes/nord-light.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "./json-value.js";

export const DEFAULT_CODE_THEME_DARK = "pierre-dark";
export const DEFAULT_CODE_THEME_LIGHT = "pierre-light";

export const codeThemeNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
    "Code theme names may use letters, digits, '.', '_', ':', and '-' and cannot start with '.'",
  );

const codeThemePairSchema = z
  .object({
    dark: codeThemeNameSchema,
    light: codeThemeNameSchema,
  })
  .strict();
export type CodeThemePair = z.infer<typeof codeThemePairSchema>;

const vscodeThemeJsonSchema = jsonObjectSchema.and(
  z.object({ name: z.string().min(1) }),
);
type VscodeThemeJson = JsonObject & { name: string };

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

export const uiCodeThemeDeclarationSchema = z
  .object({
    dark: z.string().min(1).max(256).optional(),
    light: z.string().min(1).max(256).optional(),
  })
  .strict();
export type UiCodeThemeDeclaration = z.infer<
  typeof uiCodeThemeDeclarationSchema
>;

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

function jsonDepthExceeds(value: JsonValue, maxDepth: number): boolean {
  const visit = (node: JsonValue, depth: number): boolean => {
    if (depth > maxDepth) return true;
    if (Array.isArray(node)) {
      return node.some((entry) => visit(entry, depth + 1));
    }
    const object = jsonObjectSchema.safeParse(node);
    return (
      object.success &&
      Object.values(object.data).some((entry) => visit(entry, depth + 1))
    );
  };
  return visit(value, 0);
}

export function parseVscodeThemeJson<T>(value: T): VscodeThemeJson | null {
  try {
    const parsedValue = jsonValueSchema.safeParse(value);
    if (!parsedValue.success) return null;
    if (jsonDepthExceeds(parsedValue.data, VSCODE_THEME_JSON_MAX_DEPTH)) {
      return null;
    }
    const parsed = vscodeThemeJsonSchema.safeParse(parsedValue.data);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function isBuiltInPaletteId(
  paletteId: string,
): paletteId is keyof typeof builtInPaletteCodeThemes {
  return Object.hasOwn(builtInPaletteCodeThemes, paletteId);
}

function paletteCodeThemeFallback(paletteId: string): CodeThemePair {
  if (isBuiltInPaletteId(paletteId)) {
    return builtInPaletteCodeThemes[paletteId];
  }
  return builtInPaletteCodeThemes.default;
}

const builtInPaletteCodeThemeFiles = {
  nord: { "bb:nord:light": nordLightCodeTheme },
  dracula: { "bb:dracula:light": draculaLightCodeTheme },
} satisfies Partial<
  Record<keyof typeof builtInPaletteCodeThemes, Record<string, JsonObject>>
>;

function isBuiltInPaletteFileId(
  paletteId: string,
): paletteId is keyof typeof builtInPaletteCodeThemeFiles {
  return Object.hasOwn(builtInPaletteCodeThemeFiles, paletteId);
}

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
  const builtInFiles = isBuiltInPaletteFileId(paletteId)
    ? builtInPaletteCodeThemeFiles[paletteId]
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
