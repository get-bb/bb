import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { RouteAnchor } from "@/components/ui/app-route-anchor";

const REMARK_PLUGINS = [remarkGfm];

interface NotificationMarkdownProps {
  children: string;
}

const COMPONENTS: Components = {
  a: ({ children, href }) => (
    <RouteAnchor
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {children}
    </RouteAnchor>
  ),
  p: ({ children }) => (
    <p className="mb-1 whitespace-pre-wrap last:mb-0">{children}</p>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 font-mono">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-1 whitespace-pre-wrap rounded bg-muted p-2">
      {children}
    </pre>
  ),
  ul: ({ children }) => <ul className="list-disc pl-4">{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className="list-decimal pl-4">
      {children}
    </ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-2">
      {children}
    </blockquote>
  ),
  img: ({ alt }) => <>{alt}</>,
};

export default function NotificationMarkdown({
  children,
}: NotificationMarkdownProps) {
  return (
    <div className="whitespace-normal">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
