import { useEffect } from "react";
import { atom, getDefaultStore, useSetAtom } from "jotai";
import {
  defaultFaviconColor,
  faviconColorPreferenceSchema,
  type FaviconColor,
  type FaviconColorPreference,
} from "@bb/domain";
import { useUpdateAppearance } from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";

// Reused as both the boot cache (apply the last-known tint before /system/config
// loads, so the tab icon doesn't flash) and the legacy source for the one-time
// migration off the old localStorage-only preference.
export const FAVICON_COLOR_STORAGE_KEY = "bb.faviconColor";

export const FAVICON_BADGES = ["none", "unread"] as const;
export type FaviconBadge = (typeof FAVICON_BADGES)[number];

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

function readCachedFaviconColor(): FaviconColorPreference {
  try {
    const parsed = faviconColorPreferenceSchema.safeParse(
      localStorage.getItem(FAVICON_COLOR_STORAGE_KEY),
    );
    return parsed.success ? parsed.data : defaultFaviconColor;
  } catch {
    return defaultFaviconColor;
  }
}

function cacheFaviconColor(color: FaviconColorPreference): void {
  try {
    if (color === defaultFaviconColor) {
      localStorage.removeItem(FAVICON_COLOR_STORAGE_KEY);
    } else {
      localStorage.setItem(FAVICON_COLOR_STORAGE_KEY, color);
    }
  } catch {
    // Best-effort cache; ignore private-mode / quota failures.
  }
}

// Seeded from the boot cache so initializeFavicon() can tint immediately, then
// reconciled with the server's authoritative value by useFaviconColorSync().
const faviconColorAtom = atom<FaviconColorPreference>(readCachedFaviconColor());
const faviconBadgeAtom = atom<FaviconBadge>("none");

function setActiveFaviconColor(color: FaviconColorPreference): void {
  getDefaultStore().set(faviconColorAtom, color);
  cacheFaviconColor(color);
}

let legacyFaviconColorMigrated = false;

/**
 * Reconciles the favicon tint with the server-stored appearance and re-applies
 * it whenever /system/config changes (another window updated it). Also performs
 * a one-time migration off the old localStorage-only preference: if this client
 * still has a non-default cached color and the server has none, adopt it
 * server-side so the choice survives the move to server storage.
 */
export function useFaviconColorSync(): void {
  const { data } = useSystemConfig();
  const appearance = data?.appearance;
  const { mutate: updateAppearance } = useUpdateAppearance();

  useEffect(() => {
    if (!appearance) return;
    const legacy = readCachedFaviconColor();
    const needsMigration =
      legacy !== defaultFaviconColor &&
      appearance.faviconColor === defaultFaviconColor;
    if (needsMigration) {
      // Keep showing the legacy tint locally until the server adopts it (so it
      // doesn't flash to default mid-flight), and fire the migration once.
      setActiveFaviconColor(legacy);
      if (!legacyFaviconColorMigrated) {
        legacyFaviconColorMigrated = true;
        updateAppearance({ themeId: appearance.themeId, faviconColor: legacy });
      }
      return;
    }
    setActiveFaviconColor(appearance.faviconColor);
  }, [appearance, updateAppearance]);
}

export function useFaviconBadge(badge: FaviconBadge): void {
  const setFaviconBadge = useSetAtom(faviconBadgeAtom);

  useEffect(() => {
    setFaviconBadge(badge);
    return () => {
      setFaviconBadge("none");
    };
  }, [badge, setFaviconBadge]);
}

const FAVICON_SIZES = [32, 16] as const;
const UNREAD_BADGE_FILL = "#e00000";

type FaviconSize = (typeof FAVICON_SIZES)[number];

interface FaviconRenderState {
  badge: FaviconBadge;
  colorPreference: FaviconColorPreference;
}

interface FaviconRenderRequest extends FaviconRenderState {
  baseHref: string;
}

interface RenderedFaviconLink {
  href: string;
  size: FaviconSize;
}

interface UnreadBadgeDot {
  centerX: number;
  centerY: number;
  radius: number;
}

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
async function createFaviconHref({
  badge,
  baseHref,
  colorPreference,
}: FaviconRenderRequest): Promise<string> {
  if (badge === "none" && colorPreference === "default") {
    return baseHref;
  }

  const image = await loadImage(baseHref);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.drawImage(image, 0, 0);

  if (colorPreference !== "default") {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = FAVICON_COLOR_VALUES[colorPreference];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-over";
  }

  if (badge === "unread") {
    drawUnreadBadge(context, canvas.width, canvas.height);
  }

  return canvas.toDataURL("image/png");
}

function getUnreadBadgeDot(width: number, height: number): UnreadBadgeDot {
  const size = Math.min(width, height);
  const scale = size / 32;
  return {
    centerX: 28 * scale,
    centerY: 6 * scale,
    radius: 3.5 * scale,
  };
}

function drawUnreadBadge(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const badge = getUnreadBadgeDot(width, height);
  context.save();
  context.beginPath();
  context.arc(badge.centerX, badge.centerY, badge.radius, 0, Math.PI * 2);
  context.fillStyle = UNREAD_BADGE_FILL;
  context.fill();
  context.restore();
}

let applyToken = 0;

async function applyFaviconState(state: FaviconRenderState): Promise<void> {
  const token = ++applyToken;
  const suffix = getFaviconVariantSuffix();
  const links = await Promise.all(
    FAVICON_SIZES.map(async (size): Promise<RenderedFaviconLink> => {
      const baseHref = `/favicon-${size}x${size}${suffix}.png`;
      const href = await createFaviconHref({
        badge: state.badge,
        baseHref,
        colorPreference: state.colorPreference,
      });
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
 * Applies the favicon state on startup and re-applies it whenever the color
 * preference, unread badge, or system color scheme changes. The scheme listener runs
 * after the index.html bootstrap listener (registered first), so a tinted
 * or badged favicon survives that script resetting the hrefs on theme changes.
 */
export function initializeFavicon(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const store = getDefaultStore();
  const apply = () => {
    // On failure (e.g. the favicon image fails to load), keep whatever the
    // index.html bootstrap script already applied.
    void applyFaviconState({
      badge: store.get(faviconBadgeAtom),
      colorPreference: store.get(faviconColorAtom),
    }).catch(() => {});
  };
  store.sub(faviconColorAtom, apply);
  store.sub(faviconBadgeAtom, apply);
  if (typeof window.matchMedia === "function") {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", apply);
  }
  apply();
}
