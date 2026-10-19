import { createFileRoute } from "@tanstack/react-router";

import { useInitAnalytics } from "../landing/analytics";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import blogCss from "../blog/blog.css?url";
import brandCss from "../landing/brand.css?url";

const PAGE_TITLE = "Brand assets — bb";
const PAGE_DESCRIPTION =
  "Download the bb logo as SVG or high-resolution PNG with a transparent background.";

interface LogoVariant {
  file: string;
  name: string;
  tile: "light" | "dark";
}

const VARIANTS: readonly LogoVariant[] = [
  {
    file: "bb-logo-flat-black",
    name: "Flat black",
    tile: "light",
  },
  {
    file: "bb-logo-flat-white",
    name: "Flat white",
    tile: "dark",
  },
  {
    file: "bb-logo-shaded",
    name: "Shaded",
    tile: "light",
  },
];

export const Route = createFileRoute("/brand")({
  head: () => ({
    meta: pageMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/brand"),
    links: siteHeadLinks(blogCss, brandCss),
  }),
  component: BrandRoute,
});

function BrandRoute() {
  useInitAnalytics();

  return (
    <div className="wrap">
      <SiteNav />

      <article className="post article">
        <div className="post-body">
          <h1>Brand assets</h1>
          <p className="lede">
            Download the bb logo for slides, posts, and docs. Every file has a
            transparent background.
          </p>

          <ul className="brand-grid">
            {VARIANTS.map((variant) => (
              <li key={variant.file} className="brand-card">
                <div className={`brand-tile brand-tile-${variant.tile}`}>
                  <img
                    src={`/brand/${variant.file}.svg`}
                    alt={`bb logo, ${variant.name.toLowerCase()}`}
                    width={507}
                    height={405}
                  />
                </div>
                <div className="brand-meta">
                  <h2>{variant.name}</h2>
                  <div className="brand-downloads">
                    <a href={`/brand/${variant.file}.svg`} download>
                      SVG
                    </a>
                    <a href={`/brand/${variant.file}.png`} download>
                      PNG
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}
