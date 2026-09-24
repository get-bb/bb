import { Textarea } from "./textarea";

export default {
  title: "shared-ui/Textarea",
};

export const Default = () => (
  <Textarea
    placeholder="Extra instructions prepended to dispatched threads"
    className="min-h-20 text-xs"
    onChange={() => {}}
  />
);

export const Filled = () => (
  <Textarea
    value="Prefers concise summaries and avoids jargon."
    maxLength={16_000}
    aria-label="Memory details"
    className="min-h-28 resize-y text-sm"
    onChange={() => {}}
  />
);

export const CommentBox = () => (
  <Textarea
    placeholder="Leave a comment…"
    rows={3}
    onChange={() => {}}
  />
);

export const Disabled = () => (
  <Textarea
    value="Summarize the last 10 commits."
    disabled
    aria-label="Automation prompt"
    className="min-h-28 resize-none border-0 bg-transparent px-4 pb-1 pr-14 pt-3 text-sm leading-relaxed shadow-none focus-visible:ring-0"
    onChange={() => {}}
  />
);
