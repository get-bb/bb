import { getDefaultStore, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createLocalStorageEnumStorage } from "./browser-storage";

export const FAVICON_COLOR_STORAGE_KEY = "bb.faviconColor";

export const FAVICON_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type FaviconColor = (typeof FAVICON_COLORS)[number];
export type FaviconColorPreference = FaviconColor | "default";

export const FAVICON_COLOR_VALUES: Record<FaviconColor, string> = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#ffba18",
  green: "#30a46c",
  teal: "#12a594",
  blue: "#0090ff",
  purple: "#8e4ec6",
  pink: "#d6409f",
};

function isFaviconColorPreference(
  value: string,
): value is FaviconColorPreference {
  return value === "default" || FAVICON_COLORS.some((color) => color === value);
}

const faviconColorPreferenceStorage =
  createLocalStorageEnumStorage<FaviconColorPreference>(
    isFaviconColorPreference,
  );

const faviconColorPreferenceAtom = atomWithStorage<FaviconColorPreference>(
  FAVICON_COLOR_STORAGE_KEY,
  "default",
  faviconColorPreferenceStorage,
  { getOnInit: true },
);

export function useFaviconColorPreference() {
  return useAtom(faviconColorPreferenceAtom);
}

const FAVICON_SIZES = [32, 16] as const;

/**
 * Favicon glyph used as a CSS mask when previewing colors in the UI. Only
 * the alpha channel matters for masking, so the light/dark variants are
 * interchangeable; dev builds use the dev glyph to match the actual favicon.
 */
export function getFaviconGlyphHref(): string {
  return import.meta.env.DEV ? "/favicon-32x32-dev.png" : "/favicon-32x32.png";
}

/**
 * Mirrors the favicon bootstrap script in index.html: dev builds use the
 * "-dev" variant, production follows the system color scheme.
 */
function getFaviconVariantSuffix(): string {
  if (import.meta.env.DEV) return "-dev";
  if (typeof window.matchMedia !== "function") return "";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "-dark"
    : "";
}

function getFaviconLink(size: number): HTMLLinkElement | null {
  const element = document.getElementById(`favicon-${size}`);
  return element instanceof HTMLLinkElement ? element : null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Failed to load favicon image: ${src}`));
    image.src = src;
  });
}

/**
 * The favicon is a monochrome glyph on a transparent background, so tinting
 * is a straight color replacement: draw the glyph, then fill with the target
 * color using "source-in" compositing to keep only the glyph's alpha.
 */
async function createTintedFaviconHref(
  baseHref: string,
  color: string,
): Promise<string> {
  const image = await loadImage(baseHref);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.drawImage(image, 0, 0);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

let applyToken = 0;

async function applyFaviconColor(
  preference: FaviconColorPreference,
): Promise<void> {
  const token = ++applyToken;
  const suffix = getFaviconVariantSuffix();
  const links = await Promise.all(
    FAVICON_SIZES.map(async (size) => {
      const baseHref = `/favicon-${size}x${size}${suffix}.png`;
      const href =
        preference === "default"
          ? baseHref
          : await createTintedFaviconHref(
              baseHref,
              FAVICON_COLOR_VALUES[preference],
            );
      return { href, size };
    }),
  );
  if (token !== applyToken) return;
  for (const { href, size } of links) {
    const link = getFaviconLink(size);
    if (link) link.href = href;
  }
}

let initialized = false;

/**
 * Applies the stored favicon color on startup and re-applies it whenever the
 * preference or the system color scheme changes. The scheme listener runs
 * after the index.html bootstrap listener (registered first), so a tinted
 * favicon survives that script resetting the hrefs on theme changes.
 */
export function initializeFaviconColor(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const store = getDefaultStore();
  const apply = () => {
    // On failure (e.g. the favicon image fails to load), keep whatever the
    // index.html bootstrap script already applied.
    void applyFaviconColor(store.get(faviconColorPreferenceAtom)).catch(
      () => {},
    );
  };
  store.sub(faviconColorPreferenceAtom, apply);
  if (typeof window.matchMedia === "function") {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", apply);
  }
  apply();
}
