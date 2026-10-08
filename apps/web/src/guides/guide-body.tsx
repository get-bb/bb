import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Children, isValidElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { isRenderableHref } from "../blog/parse-post";
import { LightboxImage } from "../blog/lightbox";
import { headingId } from "./parse-guide";

const REMARK_PLUGINS = [remarkGfm];

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return textOf(child.props.children);
      }
      return "";
    })
    .join("");
}

function GuideLink({ href, children }: ComponentPropsWithoutRef<"a">) {
  if (!href || !isRenderableHref(href)) {
    return <span>{children}</span>;
  }
  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}

function GuideMedia({ src, alt, title }: ComponentPropsWithoutRef<"img">) {
  if (!src || typeof src !== "string" || !isRenderableHref(src)) {
    return null;
  }
  const label = alt ?? "";
  return (
    <figure className="post-figure">
      {src.endsWith(".mp4") ? (
        <video
          className="guide-video"
          controls
          muted
          playsInline
          preload="metadata"
          poster={src.replace(/\.mp4$/, "-poster.jpg")}
          aria-label={label}
        >
          <source src={src} type="video/mp4" />
        </video>
      ) : (
        <LightboxImage src={src} alt={label} />
      )}
      {title ? <figcaption>{title}</figcaption> : null}
    </figure>
  );
}

function isMediaOnly(children: ReactNode): boolean {
  const items = Children.toArray(children);
  return (
    items.length === 1 &&
    isValidElement(items[0]) &&
    items[0].type === GuideMedia
  );
}

const COMPONENTS: Components = {
  a: GuideLink,
  img: GuideMedia,
  p: ({ children }) =>
    isMediaOnly(children) ? <>{children}</> : <p>{children}</p>,
  h2: ({ children }) => <h2 id={headingId(textOf(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={headingId(textOf(children))}>{children}</h3>,
  table: ({ children }) => (
    <div className="guide-table">
      <table>{children}</table>
    </div>
  ),
};

export function GuideBody({ markdown }: { markdown: string }) {
  return (
    <div className="guide-body">
      <ReactMarkdown
        skipHtml
        remarkPlugins={REMARK_PLUGINS}
        components={COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
