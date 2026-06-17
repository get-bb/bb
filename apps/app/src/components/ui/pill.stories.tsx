import { Pill, type PillVariant } from "./pill";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/Pill",
};

const variants: readonly PillVariant[] = [
  "secondary",
  "destructive",
  "outline",
  "emphasis",
];

// Lowercase, single-token labels — matching the status/type tags pills carry in
// the app (the workflow-run status enum is all lowercase: queued/running/failed/
// …; thread-type pills are child/fork/side chat). Descriptive multi-word labels
// (e.g. "Invalid local path") stay sentence case.
const VARIANT_CONTENT: Record<PillVariant, string> = {
  secondary: "managed",
  destructive: "failed",
  outline: "manager",
  emphasis: "active",
};

export function Overview() {
  return (
    <>
      <StoryCard>
        {variants.map((variant) => (
          <StoryRow key={variant} label={variant}>
            <Pill variant={variant}>{VARIANT_CONTENT[variant]}</Pill>
          </StoryRow>
        ))}
      </StoryCard>
      <StoryCard>
        <StoryRow label="standard">
          <Pill variant="outline">feat/review-flow</Pill>
        </StoryRow>
        <StoryRow label="truncated" hint="max-w-40">
          <Pill variant="outline" className="max-w-40">
            feat/very-long-branch-name-that-truncates
          </Pill>
        </StoryRow>
      </StoryCard>
      <StoryCard>
        <StoryRow label="child" hint="non-fork child thread">
          <Pill variant="outline">child</Pill>
        </StoryRow>
        <StoryRow label="fork" hint="forked thread">
          <Pill variant="outline">fork</Pill>
        </StoryRow>
      </StoryCard>
      <StoryCard>
        <StoryRow label="default" hint="px-2 py-0.5">
          <Pill variant="outline">fork</Pill>
        </StoryRow>
        <StoryRow label="sm" hint="compact — thread header">
          <Pill variant="outline" size="sm">
            fork
          </Pill>
        </StoryRow>
      </StoryCard>
    </>
  );
}
