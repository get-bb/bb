import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, {
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

const ALLOWED_ELEMENTS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
];

const REMARK_PLUGINS = [remarkGfm];

function httpsOnly(url: string): string | null {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const aboutUrlTransform: UrlTransform = (url) => httpsOnly(url) ?? "";

function AboutLink({ children, href }: ComponentPropsWithoutRef<"a">) {
  const safeHref = href === undefined ? null : httpsOnly(href);
  if (safeHref === null) return <span>{children}</span>;
  return (
    <a href={safeHref} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const ABOUT_COMPONENTS: Components = {
  a: AboutLink,
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h5>{children}</h5>,
  h5: ({ children }) => <h6>{children}</h6>,
};

export function MarketplaceAbout({ markdown }: { markdown: string }) {
  return (
    <div className="marketplace-about">
      <ReactMarkdown
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        skipHtml
        remarkPlugins={REMARK_PLUGINS}
        components={ABOUT_COMPONENTS}
        urlTransform={aboutUrlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
