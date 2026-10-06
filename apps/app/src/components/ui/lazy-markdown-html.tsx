import ReactMarkdown, { type Options } from "react-markdown";
import { defineSplit, SplitLoadFailure } from "@/lib/define-split";
import { Skeleton } from "@bb/shared-ui/skeleton";

export const LazyMarkdownHtml = defineSplit<Options>({
  id: "markdown-html",
  tier: "intent",
  load: () => import("./markdown-html").then((module) => module.MarkdownHtml),
  loading: (props) => (
    <>
      <ReactMarkdown {...props} skipHtml />
      <Skeleton className="h-4 w-32" aria-label="Loading embedded HTML" />
    </>
  ),
  error: ({ retry, ...props }) => (
    <>
      <ReactMarkdown {...props} skipHtml />
      <SplitLoadFailure retry={retry} />
    </>
  ),
});
