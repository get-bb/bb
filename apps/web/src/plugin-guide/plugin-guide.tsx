import bbLogoUrl from "../../../../assets/bb-logo.svg?url";
import { ProductMap } from "../../../../plugins/plugin-api-docs/src/product-map";
import {
  GROUP_BY_SURFACE_ID,
  type PluginSurface,
} from "../../../../plugins/plugin-api-docs/src/surfaces";

const PLUGIN_BRANDING = import.meta.glob<{
  name?: string;
  branding?: { icon?: string };
}>("../../../../plugins/*/package.json", { import: "bb", eager: true });

const PLUGIN_ICON_URLS = import.meta.glob<string>(
  "../../../../plugins/*/{icons/*.svg,*.svg}",
  { query: "?url", import: "default", eager: true },
);

const BRAND_ICON_URL_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(PLUGIN_BRANDING).flatMap(([manifestPath, bb]) => {
    const icon = bb?.branding?.icon;
    if (!bb?.name || !icon?.startsWith("./")) return [];
    const url =
      PLUGIN_ICON_URLS[manifestPath.replace(/package\.json$/, icon.slice(2))];
    return url === undefined ? [] : [[bb.name, url] as const];
  }),
);

const PLUGIN_SOURCE_ROOT = "https://github.com/get-bb/bb/tree/main/plugins/";

const PLUGIN_DIR_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(PLUGIN_BRANDING).flatMap(([manifestPath, bb]) => {
    const dir = /\/plugins\/([^/]+)\/package\.json$/.exec(manifestPath)?.[1];
    return bb?.name && dir ? [[bb.name, dir] as const] : [];
  }),
);

function pluginSourceHref(displayName: string): string | null {
  const dir = PLUGIN_DIR_BY_NAME.get(displayName);
  return dir === undefined
    ? null
    : `${PLUGIN_SOURCE_ROOT}${encodeURIComponent(dir)}`;
}

function renderBrandIcon(displayName: string) {
  const url = BRAND_ICON_URL_BY_NAME.get(displayName);
  return url === undefined ? null : (
    <span
      aria-hidden
      className="inline-block size-3.5 shrink-0 bg-current text-subtle-foreground"
      style={{
        maskImage: `url("${url}")`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}

export function pluginSurfaceAgentPrompt(
  surface: PluginSurface,
  origin: string,
): string {
  const group = GROUP_BY_SURFACE_ID.get(surface.id);
  const guideUrl = new URL("/plugin-guide", origin);
  if (group) guideUrl.searchParams.set("slide", group.id);
  return [
    `Build a bb plugin that uses ${surface.title}.`,
    surface.summary
      .replace(/ With this, a plugin can:$/, "")
      .replace(/\[([^\]]+)\]\([a-z0-9-]+\)/g, "$1"),
    `Plugin Guide surface: ${surface.title} (${surface.id}).`,
    `Relevant @get-bb/plugin-sdk symbols: ${surface.apiSymbols.join(", ")}.`,
    "Use the bb-plugin-authoring skill and the authoritative @get-bb/plugin-sdk declarations to build it.",
    `Plugin Guide: ${guideUrl.href}`,
  ].join("\n");
}

async function copyForAgent(surface: PluginSurface): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(
      pluginSurfaceAgentPrompt(surface, window.location.origin),
    );
    return true;
  } catch {
    return false;
  }
}

export default function PluginGuide({
  initialSlideId,
  onSlideChange,
}: {
  initialSlideId?: string;
  onSlideChange?: (slideId: string) => void;
}) {
  return (
    <ProductMap
      pluginPageHref={pluginSourceHref}
      renderPluginIcon={renderBrandIcon}
      initialSlideId={initialSlideId}
      onSlideChange={onSlideChange}
      onCopyForAgent={copyForAgent}
      mobileOnlyOnCompactViewport
      brandMark={
        <img
          src={bbLogoUrl}
          alt="bb"
          className="inline-block h-[0.9em] w-auto align-[-0.1em] dark:invert"
        />
      }
    />
  );
}
