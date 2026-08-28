import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  CUSTOM_CODE_THEME_JSON_MAX_LENGTH,
  codeThemeNameSchema,
  formatRegisteredCodeThemeName,
  isCodeThemeFilePath,
  parseVscodeThemeJson,
  jsonObjectSchema,
  type DeclaredCodeTheme,
  type DeclaredCodeThemeSlot,
  type UiCodeThemeDeclaration,
} from "@bb/domain";
const { existsSync, readFileSync } = process.getBuiltinModule("node:fs");

const THEME_MANIFEST_FILE_NAME = "theme.json";
const CONVENTION_CODE_THEME_FILES = {
  dark: "pierre-dark.json",
  light: "pierre-light.json",
} as const;

interface PluginThemeCodeThemePaths {
  dark?: string;
  light?: string;
}

function resolveWithinRoot(
  rootDir: string,
  entry: string,
  label: string,
): string {
  if (isAbsolute(entry)) {
    throw new Error(`${label} must be relative, got "${entry}"`);
  }
  const resolved = resolve(rootDir, entry);
  if (resolved !== rootDir && !resolved.startsWith(rootDir + "/")) {
    throw new Error(`${label} escapes the theme directory: "${entry}"`);
  }
  return resolved;
}

function readThemeJsonFile(path: string): DeclaredCodeThemeSlot["file"] | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  if (raw.length > CUSTOM_CODE_THEME_JSON_MAX_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseVscodeThemeJson(parsed);
}

function resolveDeclaredSlot(
  sourceId: string,
  side: "dark" | "light",
  value: string,
  rootDir: string,
): DeclaredCodeThemeSlot | undefined {
  if (!isCodeThemeFilePath(value)) {
    const name = codeThemeNameSchema.safeParse(value);
    return name.success ? { name: name.data } : undefined;
  }
  let path: string;
  try {
    path = resolveWithinRoot(rootDir, value, `codeTheme.${side}`);
  } catch {
    return undefined;
  }
  const file = readThemeJsonFile(path);
  if (file === null) return undefined;
  return {
    name: formatRegisteredCodeThemeName(sourceId, side),
    file,
  };
}

function readThemeManifestDeclaration(
  themeDir: string,
): UiCodeThemeDeclaration | null {
  const path = join(themeDir, THEME_MANIFEST_FILE_NAME);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  if (raw.length > CUSTOM_CODE_THEME_JSON_MAX_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const manifest = jsonObjectSchema.safeParse(parsed);
  if (!manifest.success) return null;
  const codeTheme = manifest.data.codeTheme;
  if (codeTheme === undefined) return {};
  const record = jsonObjectSchema.safeParse(codeTheme);
  if (!record.success) return null;
  const declaration: UiCodeThemeDeclaration = {};
  const dark = z.string().safeParse(record.data.dark);
  const light = z.string().safeParse(record.data.light);
  if (dark.success) declaration.dark = dark.data;
  if (light.success) declaration.light = light.data;
  return declaration;
}

export function readCustomThemeCodeTheme(
  themeRoot: string,
  name: string,
): DeclaredCodeTheme | null {
  const themeDir = join(themeRoot, name);
  const manifest = readThemeManifestDeclaration(themeDir);
  const darkRef = manifest?.dark ?? CONVENTION_CODE_THEME_FILES.dark;
  const lightRef = manifest?.light ?? CONVENTION_CODE_THEME_FILES.light;
  const declared: DeclaredCodeTheme = {};
  const dark = resolveDeclaredSlot(name, "dark", darkRef, themeDir);
  const light = resolveDeclaredSlot(name, "light", lightRef, themeDir);
  if (dark) declared.dark = dark;
  if (light) declared.light = light;
  return declared.dark || declared.light ? declared : null;
}

export function readPluginThemeCodeTheme(
  sourceId: string,
  declaration: UiCodeThemeDeclaration | undefined,
  paths: PluginThemeCodeThemePaths,
): DeclaredCodeTheme | null {
  const declared: DeclaredCodeTheme = {};
  if (paths.dark !== undefined) {
    const file = readThemeJsonFile(paths.dark);
    if (file !== null) {
      declared.dark = {
        name: formatRegisteredCodeThemeName(sourceId, "dark"),
        file,
      };
    }
  } else if (
    declaration?.dark !== undefined &&
    !isCodeThemeFilePath(declaration.dark)
  ) {
    const name = codeThemeNameSchema.safeParse(declaration.dark);
    if (name.success) declared.dark = { name: name.data };
  }
  if (paths.light !== undefined) {
    const file = readThemeJsonFile(paths.light);
    if (file !== null) {
      declared.light = {
        name: formatRegisteredCodeThemeName(sourceId, "light"),
        file,
      };
    }
  } else if (
    declaration?.light !== undefined &&
    !isCodeThemeFilePath(declaration.light)
  ) {
    const name = codeThemeNameSchema.safeParse(declaration.light);
    if (name.success) declared.light = { name: name.data };
  }
  return declared.dark || declared.light ? declared : null;
}

export function resolvePluginCodeThemePath(
  rootDir: string,
  themeId: string,
  side: "dark" | "light",
  value: string,
): string {
  return resolveWithinRoot(
    rootDir,
    value,
    `bb.themes.${themeId}.codeTheme.${side}`,
  );
}
