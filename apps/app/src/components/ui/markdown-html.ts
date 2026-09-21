import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

export const MARKDOWN_HTML_REHYPE_PLUGINS: [
  typeof rehypeRaw,
  typeof rehypeSanitize,
] = [rehypeRaw, rehypeSanitize];
