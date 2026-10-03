import { Buffer } from "node:buffer";
import { ImageResponse } from "cf-workers-og";
import bbMark from "../assets/bb-icon.png?inline";
import type { PublicMarketplaceData } from "./marketplace-data.js";
import { marketplacePluginIcon } from "./marketplace-icons.js";
import type { MarketplaceV2Entry } from "./marketplace-v2.js";
import {
  marketplaceAssetUrl,
  resolveMarketplaceCategory,
} from "./marketplace-view-model.js";

const INK = "#333333";
const DIM = "#6b6b6b";
const MUTED = "#8a8a8a";
const BORDER = "#e4e4e4";
const ACCENT = "#4075aa";
const RECESSED = "#f1f1f1";
const MAX_ASSET_BYTES = 4_000_000;
const MAX_IMAGE_PIXELS = 4_200_000;
const MAX_SVG_BYTES = 64_000;
const UNSAFE_SVG = /<!(?:DOCTYPE|ENTITY)|<(?:[\w.-]+:)?(?:image|feImage)\b/iu;

type MarketplaceOgAssetLoader = (url: string) => Promise<Response>;

interface MarketplaceOgArtwork {
  icon: string | null;
  screenshot: string | null;
  avatar: string | null;
}

function clip(text: string, length: number) {
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  const space = cut.lastIndexOf(" ");
  const words = space > length * 0.6 ? cut.slice(0, space) : cut;
  return `${words.replace(/[\s.,;:!?—–-]+$/u, "")}…`;
}

function summary(text: string, length: number) {
  if (text.length <= length) return text;
  const sentenceEnd = text.slice(0, length).lastIndexOf(". ");
  return sentenceEnd > length * 0.4
    ? text.slice(0, sentenceEnd + 1)
    : clip(text, length);
}

function PluginIcon({
  entry,
  icon,
  size,
}: {
  entry: MarketplaceV2Entry;
  icon: string | null;
  size: number;
}) {
  const glyph = Math.round(size * 0.55);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.26),
        border: `2px solid ${BORDER}`,
        background: "#ffffff",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.08)",
        color: INK,
      }}
    >
      {icon ? (
        <img src={icon} width={glyph} height={glyph} />
      ) : (
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
          {marketplacePluginIcon(
            typeof entry.icon === "string" ? entry.icon : "Puzzle",
          ).map(([tag, { key: _key, ...attributes }], index) => {
            const Tag = tag as "path";
            return <Tag key={index} {...attributes} />;
          })}
        </svg>
      )}
    </div>
  );
}

function BrandMark() {
  const height = 26;
  const width = Math.round((height * 0.95) / 0.8);
  const imageWidth = width * 1.7778;
  const imageHeight = height * 2.1099;
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width,
        height,
        overflow: "hidden",
      }}
    >
      <img
        src={bbMark}
        width={imageWidth}
        height={imageHeight}
        style={{
          position: "absolute",
          left: (width - imageWidth) / 2,
          top: (height - imageHeight) * 0.505,
        }}
      />
    </div>
  );
}

function authorInitials(name: string) {
  return name
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

function AuthorAvatar({
  name,
  avatar,
}: {
  name: string;
  avatar: string | null;
}) {
  const size = 32;
  if (avatar) {
    return (
      <img
        src={avatar}
        width={size}
        height={size}
        style={{ borderRadius: 999, objectFit: "cover" }}
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: RECESSED,
        color: DIM,
        fontSize: 13,
      }}
    >
      {authorInitials(name)}
    </div>
  );
}

export function marketplaceOgCard(
  entry: MarketplaceV2Entry,
  artwork: MarketplaceOgArtwork,
  category: string | null = null,
) {
  const { screenshot } = artwork;
  const name = clip(entry.displayName, screenshot ? 32 : 40);
  const titleSize = Math.min(
    screenshot ? 44 : 64,
    Math.floor((screenshot ? 384 : 696) / (name.length * 0.48)),
  );
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundImage: "linear-gradient(135deg, #ffffff 35%, #ececec 100%)",
        color: INK,
        fontFamily: "Roboto",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: screenshot ? 520 : 760,
          height: "100%",
          padding: "64px 0 56px 64px",
        }}
      >
        <BrandMark />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {category ? (
            <div
              style={{
                display: "flex",
                marginBottom: 16,
                fontSize: 20,
                color: ACCENT,
              }}
            >
              {category}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {screenshot ? (
              <div style={{ display: "flex", marginLeft: -4 }}>
                <PluginIcon entry={entry} icon={artwork.icon} size={56} />
              </div>
            ) : null}
            <div
              style={{
                fontSize: titleSize,
                lineHeight: 1.05,
                letterSpacing: titleSize > 40 ? -1.5 : -1,
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </div>
          </div>
          <div
            style={{
              fontSize: screenshot ? 23 : 26,
              lineHeight: 1.4,
              marginTop: 18,
              color: DIM,
            }}
          >
            {summary(entry.description, screenshot ? 80 : 150)}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", fontSize: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              gap: 10,
              color: MUTED,
              whiteSpace: "nowrap",
            }}
          >
            <AuthorAvatar name={entry.author.name} avatar={artwork.avatar} />
            {clip(entry.author.name, screenshot ? 30 : 48)}
          </div>
        </div>
      </div>
      {screenshot ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 572,
            top: 152,
            width: 736,
            height: 520,
            borderRadius: 24,
            background: "#ffffff",
            boxShadow: "0 24px 64px rgba(0, 0, 0, 0.18)",
          }}
        />
      ) : null}
      {screenshot ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 560,
            top: 128,
            width: 760,
            height: 640,
            padding: 10,
            borderRadius: 24,
            background: "#ffffff",
            border: `2px solid ${BORDER}`,
          }}
        >
          <img
            src={screenshot}
            width={736}
            height={616}
            style={{
              borderRadius: 14,
              objectFit: "cover",
              objectPosition: "left top",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            position: "absolute",
            right: 116,
            top: 185,
          }}
        >
          <PluginIcon entry={entry} icon={artwork.icon} size={260} />
        </div>
      )}
    </div>
  );
}

async function fetchAsset(url: string) {
  return fetch(url, { signal: AbortSignal.timeout(5000) });
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function rasterSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame) {
        return {
          width: view.getUint16(offset + 7),
          height: view.getUint16(offset + 5),
        };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return null;
}

async function loadImage(
  declared: string,
  loadAsset: MarketplaceOgAssetLoader,
): Promise<string | null> {
  try {
    const response = await loadAsset(marketplaceAssetUrl(declared));
    if (!response.ok) return null;
    const type = response.headers.get("content-type")?.split(";")[0];
    if (
      type !== "image/svg+xml" &&
      type !== "image/png" &&
      type !== "image/jpeg"
    ) {
      return null;
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_ASSET_BYTES) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ASSET_BYTES) return null;
    if (type !== "image/svg+xml") {
      const size = rasterSize(new Uint8Array(bytes));
      if (!size || size.width * size.height > MAX_IMAGE_PIXELS) return null;
    }
    if (type === "image/svg+xml") {
      if (bytes.byteLength > MAX_SVG_BYTES) return null;
      const svg = new TextDecoder()
        .decode(bytes)
        .replaceAll("currentColor", INK);
      if (UNSAFE_SVG.test(svg)) return null;
      return `data:${type};base64,${Buffer.from(svg).toString("base64")}`;
    }
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

async function firstImage(
  declared: readonly string[],
  loadAsset: MarketplaceOgAssetLoader,
) {
  for (const url of declared) {
    const image = await loadImage(url, loadAsset);
    if (image) return image;
  }
  return null;
}

export async function serveMarketplaceOg(
  marketplace: PublicMarketplaceData,
  pluginId: string,
  loadAsset: MarketplaceOgAssetLoader = fetchAsset,
) {
  if (marketplace.status !== "available") {
    return new Response("Marketplace unavailable", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const entry = marketplace.manifest.plugins.find(
    (plugin) => plugin.id === pluginId,
  );
  if (!entry) return new Response("Plugin not found", { status: 404 });
  const category =
    resolveMarketplaceCategory(marketplace.manifest, entry)?.displayName ??
    null;
  const [icon, screenshot, avatar] = await Promise.all([
    typeof entry.icon === "string"
      ? null
      : loadImage(entry.icon.url, loadAsset),
    firstImage(entry.screenshots, loadAsset),
    entry.author.github === undefined
      ? null
      : loadImage(
          `https://github.com/${encodeURIComponent(entry.author.github)}.png?size=72`,
          loadAsset,
        ),
  ]);
  const options = {
    width: 1200,
    height: 630,
    headers: { "cache-control": "public, max-age=300, must-revalidate" },
  };
  try {
    return await ImageResponse.create(
      marketplaceOgCard(entry, { icon, screenshot, avatar }, category),
      options,
    );
  } catch {
    return ImageResponse.create(
      marketplaceOgCard(
        entry,
        { icon: null, screenshot: null, avatar: null },
        category,
      ),
      options,
    );
  }
}
