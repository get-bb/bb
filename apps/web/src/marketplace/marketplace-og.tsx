import { Buffer } from "node:buffer";
import { ImageResponse } from "cf-workers-og";
import type { PublicMarketplaceData } from "./marketplace-data.js";
import type { MarketplaceV2Entry } from "./marketplace-v2.js";
import { marketplaceAssetUrl } from "./marketplace-view-model.js";

function clip(text: string, length: number) {
  return text.length > length
    ? `${text.slice(0, length - 1).trimEnd()}…`
    : text;
}

export function marketplaceOgCard(
  entry: MarketplaceV2Entry,
  screenshot: string | null,
) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#f5f4ef",
        color: "#242621",
        padding: 48,
        fontFamily: "Roboto",
      }}
    >
      <div style={{ display: "flex", fontSize: 24, color: "#66685f" }}>
        bb / Plugin Marketplace
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 40 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: screenshot ? 440 : 1000,
          }}
        >
          <div style={{ fontSize: 52, lineHeight: 1.1 }}>
            {clip(entry.displayName, 48)}
          </div>
          <div
            style={{
              fontSize: 26,
              lineHeight: 1.4,
              marginTop: 24,
              color: "#55584f",
            }}
          >
            {clip(entry.description, screenshot ? 170 : 320)}
          </div>
          <div style={{ fontSize: 22, marginTop: 28 }}>
            {`By ${clip(entry.author.name, 36)}`}
          </div>
        </div>
        {screenshot ? (
          <img
            src={screenshot}
            width={624}
            height={390}
            style={{
              objectFit: "contain",
              borderRadius: 16,
              background: "#e8e8df",
            }}
          />
        ) : null}
      </div>
      <div style={{ display: "flex", fontSize: 20, color: "#66685f" }}>
        getbb.app/marketplace/{entry.id}
      </div>
    </div>
  );
}

export async function serveMarketplaceOg(
  marketplace: PublicMarketplaceData,
  pluginId: string,
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
  const screenshot = entry.screenshots[0];
  const options = {
    width: 1200,
    height: 630,
    headers: { "cache-control": "public, max-age=300, must-revalidate" },
  };
  if (screenshot) {
    try {
      const response = await fetch(marketplaceAssetUrl(screenshot), {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Screenshot unavailable");
      const bytes = await response.arrayBuffer();
      const type = response.headers.get("content-type")?.split(";")[0];
      if (!type?.startsWith("image/") || bytes.byteLength > 10_000_000)
        throw new Error("Invalid screenshot");
      const dataUrl = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
      return await ImageResponse.create(
        marketplaceOgCard(entry, dataUrl),
        options,
      );
    } catch {
      return ImageResponse.create(marketplaceOgCard(entry, null), options);
    }
  }
  return ImageResponse.create(marketplaceOgCard(entry, null), options);
}
