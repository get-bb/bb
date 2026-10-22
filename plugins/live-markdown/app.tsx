import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./app.css";
import { markdownRanges, type MarkdownRangeKind } from "./markdown.js";

const STYLED_KINDS: readonly MarkdownRangeKind[] = [
  "bullet",
  "ordered",
  "h1",
  "h2",
  "h3",
  "strong",
  "em",
  "code",
];
const CARET_LINE_PLAIN_KINDS: readonly MarkdownRangeKind[] = ["marker"];

function effect(kind: MarkdownRangeKind, skipAtCaret: boolean) {
  return {
    id: kind,
    className: `bb-live-md-${kind}`,
    ...(skipAtCaret ? { experimental_skipAtCaret: "line" as const } : {}),
    match: (text: string) => markdownRanges(text)[kind],
  };
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "markdown",
    richText: {
      effects: [
        ...STYLED_KINDS.map((kind) => effect(kind, false)),
        ...CARET_LINE_PLAIN_KINDS.map((kind) => effect(kind, true)),
      ],
    },
  });
});
