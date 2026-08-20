// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  USER_MESSAGE_CHAR_CAP,
  GENERATED_MESSAGE_COLLAPSED_PREVIEW_CHAR_CAP,
  endsInsideExactRawThreadIdCodeSpan,
  boundedMarkdownPreview,
  closeUnterminatedMarkdownCodeSpan,
} from "@bb/client-core";
export type { BoundedMarkdownPreview } from "@bb/client-core";
