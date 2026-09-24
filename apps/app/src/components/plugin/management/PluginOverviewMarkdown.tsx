import type { ComponentPropsWithoutRef, ReactNode } from "react";
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

const overviewUrlTransform: UrlTransform = (url) => httpsOnly(url) ?? "";

function OverviewLink({ children, href }: ComponentPropsWithoutRef<"a">) {
  const safeHref = href === undefined ? null : httpsOnly(href);
  if (safeHref === null) return <span>{children}</span>;
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words [overflow-wrap:anywhere] underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  );
}

function OverviewHeading({
  children,
  minor = false,
}: {
  children?: ReactNode;
  minor?: boolean;
}) {
  const Tag = minor ? "h4" : "h3";
  return (
    <Tag
      className={
        minor
          ? "mb-1 mt-4 text-xs font-medium text-foreground first:mt-0"
          : "mb-1 mt-6 text-sm font-medium text-foreground first:mt-0"
      }
    >
      {children}
    </Tag>
  );
}

const OVERVIEW_COMPONENTS: Components = {
  a: OverviewLink,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-surface-selected-border pl-3">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded-sm bg-surface-recessed px-1 font-mono text-xs text-foreground [box-decoration-break:clone]">
      {children}
    </code>
  ),
  h1: ({ children }) => <OverviewHeading>{children}</OverviewHeading>,
  h2: ({ children }) => <OverviewHeading>{children}</OverviewHeading>,
  h3: ({ children }) => <OverviewHeading>{children}</OverviewHeading>,
  h4: ({ children }) => <OverviewHeading minor>{children}</OverviewHeading>,
  h5: ({ children }) => <OverviewHeading minor>{children}</OverviewHeading>,
  h6: ({ children }) => <OverviewHeading minor>{children}</OverviewHeading>,
  hr: () => <hr className="my-4 border-t border-border" />,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-4 marker:text-subtle-foreground">
      {children}
    </ol>
  ),
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-surface-recessed p-3 font-mono text-xs text-foreground">
      {children}
    </pre>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-4 marker:text-subtle-foreground">
      {children}
    </ul>
  ),
};

export function PluginOverviewMarkdown({ markdown }: { markdown: string }) {
  return (
    <div
      data-plugin-overview=""
      className="break-words text-sm leading-relaxed text-muted-foreground"
    >
      <ReactMarkdown
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        skipHtml
        remarkPlugins={REMARK_PLUGINS}
        components={OVERVIEW_COMPONENTS}
        urlTransform={overviewUrlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
