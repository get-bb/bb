import type {
  PreviewMode,
  StudioTokenName,
  ThemeStudioTokens,
} from "./studio-tokens";

interface CssBlock {
  selector: string;
  body: string;
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}

function readBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  let depth = 0;
  let blockStart = -1;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") {
      if (depth === 0) blockStart = index;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && blockStart !== -1) {
        blocks.push({
          selector: css.slice(0, blockStart).trim(),
          body: css.slice(blockStart + 1, index),
          start: 0,
          end: index + 1,
          bodyStart: blockStart + 1,
          bodyEnd: index,
        });
        blockStart = -1;
      }
    }
  }
  return blocks;
}

function isDarkBlock(selector: string): boolean {
  return /\.dark\b/.test(selector);
}

function isLightBlock(selector: string): boolean {
  return /:root\b/.test(selector) || /\.light\b/.test(selector);
}

function findBlock(css: string, mode: PreviewMode): CssBlock | null {
  const blocks = readBlocks(css);
  const match = mode === "dark" ? isDarkBlock : isLightBlock;
  return blocks.find((block) => match(block.selector)) ?? null;
}

function tokenVariable(token: StudioTokenName): string {
  return `--${token.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

export function readToken(
  css: string,
  mode: PreviewMode,
  token: StudioTokenName,
): string | null {
  const block = findBlock(css, mode);
  if (!block) return null;
  const pattern = new RegExp(`(${tokenVariable(token)}\\s*:)([^;]*);`);
  const match = block.body.match(pattern);
  return match?.[2]?.trim() ?? null;
}

export function writeToken(
  css: string,
  mode: PreviewMode,
  token: StudioTokenName,
  value: string,
): string {
  const block = findBlock(css, mode);
  if (!block) return css;

  const variable = tokenVariable(token);
  const pattern = new RegExp(`(${variable}\\s*:)([^;]*);`);
  if (pattern.test(block.body)) {
    const body = block.body.replace(pattern, `$1 ${value};`);
    return css.slice(0, block.bodyStart) + body + css.slice(block.bodyEnd);
  }

  const body = `${block.body.replace(/\s*$/, "")}\n  ${variable}: ${value};\n`;
  return css.slice(0, block.bodyStart) + body + css.slice(block.bodyEnd);
}

const ALL_TOKENS: readonly StudioTokenName[] = [
  "canvas",
  "ink",
  "primary",
  "destructive",
  "warning",
  "success",
  "prMerged",
  "fileAccent",
  "diffAdded",
  "diffRemoved",
];

export interface ExtractedTokens {
  tokens: Partial<ThemeStudioTokens>;
  missing: readonly StudioTokenName[];
}

export function extractTokens(css: string, mode: PreviewMode): ExtractedTokens {
  const tokens: Partial<ThemeStudioTokens> = {};
  const missing: StudioTokenName[] = [];
  for (const token of ALL_TOKENS) {
    const value = readToken(css, mode, token);
    if (value === null) {
      missing.push(token);
      continue;
    }
    (tokens as Record<string, string>)[token] = value;
  }
  return { tokens, missing };
}

export function hasBothModeBlocks(css: string): boolean {
  return findBlock(css, "light") !== null && findBlock(css, "dark") !== null;
}

const MANAGED: ReadonlyArray<readonly [PreviewMode, StudioTokenName]> = [
  ["light", "canvas"],
  ["light", "ink"],
  ["light", "primary"],
  ["light", "destructive"],
  ["light", "warning"],
  ["light", "success"],
  ["light", "prMerged"],
  ["light", "fileAccent"],
  ["light", "diffAdded"],
  ["light", "diffRemoved"],
  ["dark", "canvas"],
  ["dark", "ink"],
  ["dark", "primary"],
  ["dark", "destructive"],
  ["dark", "warning"],
  ["dark", "success"],
  ["dark", "prMerged"],
  ["dark", "fileAccent"],
  ["dark", "diffAdded"],
  ["dark", "diffRemoved"],
];

export function applyTokens(
  css: string,
  light: Partial<ThemeStudioTokens>,
  dark: Partial<ThemeStudioTokens>,
): string {
  let next = css;
  for (const [mode, token] of MANAGED) {
    const value = mode === "light" ? light[token] : dark[token];
    if (value === undefined) continue;
    next = writeToken(next, mode, token, value);
  }
  return next;
}

export { ALL_TOKENS as STUDIO_MANAGED_TOKENS };
