import { ImageResponse } from "cf-workers-og";

import { BrandMark, clip } from "../marketplace/marketplace-og.js";
import { DOCS_OG_SIZE } from "./docs-og-paths";

const INK = "#333333";
const DIM = "#6b6b6b";
const ACCENT = "#4075aa";

export interface DocsOgCard {
  section: string;
  title: string;
}

export function docsOgCard({ section, title }: DocsOgCard) {
  const name = clip(title, 72);
  const titleSize = name.length > 44 ? 56 : 72;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "64px 72px 60px",
        backgroundImage: "linear-gradient(135deg, #ffffff 35%, #ececec 100%)",
        color: INK,
        fontFamily: "Roboto",
      }}
    >
      <BrandMark />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            marginBottom: 24,
            fontSize: 26,
            color: ACCENT,
          }}
        >
          {section}
        </div>
        <div
          style={{
            display: "flex",
            maxWidth: 1000,
            fontSize: titleSize,
            lineHeight: 1.1,
            letterSpacing: -1.5,
          }}
        >
          {name}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 22, color: DIM }}>
        getbb.app/docs
      </div>
    </div>
  );
}

export function serveDocsOg(card: DocsOgCard | null): Promise<Response> {
  if (card === null) {
    return Promise.resolve(
      new Response("Docs page not found", { status: 404 }),
    );
  }
  return ImageResponse.create(docsOgCard(card), {
    ...DOCS_OG_SIZE,
    headers: { "cache-control": "public, max-age=86400" },
  });
}
